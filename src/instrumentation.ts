import {
  context,
  diag,
  metrics,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Histogram,
  type Link,
  type Meter,
  type Span,
  type TextMapGetter,
  type TextMapPropagator,
  type TextMapSetter,
  type Tracer,
} from '@opentelemetry/api';
import { BAGGAGE_META_KEY, PROTOCOL_VERSION_META_KEY } from './keys.js';
import {
  ATTR_ERROR_TYPE,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_PROMPT_NAME,
  ATTR_GEN_AI_TOOL_CALL_ARGUMENTS,
  ATTR_GEN_AI_TOOL_CALL_RESULT,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_JSONRPC_PROTOCOL_VERSION,
  ATTR_JSONRPC_REQUEST_ID,
  ATTR_MCP_METHOD_NAME,
  ATTR_MCP_PROTOCOL_VERSION,
  ATTR_MCP_RESOURCE_URI,
  ATTR_NETWORK_TRANSPORT,
  ATTR_RPC_RESPONSE_STATUS_CODE,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  ERROR_TYPE_VALUE_TOOL_ERROR,
  GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
  METRIC_MCP_CLIENT_OPERATION_DURATION,
  METRIC_MCP_CLIENT_SESSION_DURATION,
  METRIC_MCP_SERVER_OPERATION_DURATION,
  METRIC_MCP_SERVER_SESSION_DURATION,
} from './semconv.js';
import type {
  Connectable,
  JsonRpcErrorLike,
  JsonRpcMessageLike,
  JsonRpcNotificationLike,
  JsonRpcParams,
  JsonRpcRequestLike,
  JsonRpcResultLike,
  RequestId,
  TransportLike,
} from './types.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

export interface McpInstrumentationOptions {
  /** Defaults to the global tracer provider of `@opentelemetry/api`. */
  tracerProvider?: { getTracer(name: string, version?: string): Tracer } | undefined;
  /** Defaults to the global propagator of `@opentelemetry/api`. */
  propagator?: TextMapPropagator | undefined;
  /** Record `gen_ai.tool.call.arguments`. Off by default: arguments may be sensitive. */
  captureArguments?: boolean | undefined;
  /** Record `gen_ai.tool.call.result`. Off by default: results may be sensitive. */
  captureResults?: boolean | undefined;
  /** Value of `network.transport`, e.g. `pipe` for stdio or `tcp` for HTTP. Detected from the transport class when omitted. */
  networkTransport?: string | undefined;
  /** Value of `server.address`, for HTTP transports. */
  serverAddress?: string | undefined;
  /** Value of `server.port`, for HTTP transports. */
  serverPort?: number | undefined;
  /**
   * Put the resource uri in the span name of `resources/read`. Off by default:
   * the convention marks it opt-in because a uri raises span name cardinality
   * and can carry a path. The uri is always recorded as `mcp.resource.uri`.
   */
  resourceUriInSpanName?: boolean | undefined;
  /** Propagate into and open spans for notifications. On by default. */
  instrumentNotifications?: boolean | undefined;
  /** Defaults to the global meter provider of `@opentelemetry/api`. */
  meterProvider?: { getMeter(name: string, version?: string): Meter } | undefined;
  /** Record the four duration histograms of the convention. On by default. */
  instrumentMetrics?: boolean | undefined;
}

/** Bucket boundaries the convention recommends for its four duration histograms, in seconds. */
export const DURATION_BUCKET_BOUNDARIES = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];

export type Role = 'client' | 'server';

/** Error class recorded when a transport closes while requests are in flight. */
export const ERROR_TYPE_VALUE_CONNECTION_CLOSED = 'connection_closed';
/** Error class recorded on a request span when the caller cancels the request. */
export const ERROR_TYPE_VALUE_CANCELLED = 'cancelled';

const INSTRUMENTED: unique symbol = Symbol.for('mcp-opentelemetry.instrumented');
const CONNECT_PATCHED: unique symbol = Symbol.for('mcp-opentelemetry.connect-patched');

type Marked = { [INSTRUMENTED]?: Role };

/** True when the transport has already been instrumented by this package. */
export function isInstrumented(transport: TransportLike): boolean {
  return (transport as Marked)[INSTRUMENTED] !== undefined;
}

/* ---------------------------------------------------------------- carriers */

const metaSetter: TextMapSetter<Record<string, unknown>> = {
  set(carrier, key, value) {
    carrier[key] = value;
  },
};

/** Only strings are handed to the propagator: anything else is treated as absent. */
const metaGetter: TextMapGetter<Record<string, unknown>> = {
  get(carrier, key) {
    const value = carrier[key];
    return typeof value === 'string' ? value : undefined;
  },
  keys(carrier) {
    return Object.keys(carrier);
  },
};

/* ---------------------------------------------------------------- messages */

function isRequest(message: JsonRpcMessageLike): message is JsonRpcRequestLike {
  return 'method' in message && 'id' in message && message.id !== null && message.id !== undefined;
}

function isNotification(message: JsonRpcMessageLike): message is JsonRpcNotificationLike {
  return 'method' in message && !('id' in message && message.id !== null && message.id !== undefined);
}

function isResponse(message: JsonRpcMessageLike): message is JsonRpcResultLike | JsonRpcErrorLike {
  return !('method' in message) && ('result' in message || 'error' in message);
}

function pendingKey(id: RequestId | null): string {
  return `${typeof id}:${String(id)}`;
}

function targetOf(method: string, params: JsonRpcParams | undefined): string | undefined {
  switch (method) {
    case 'tools/call':
    case 'prompts/get':
      return typeof params?.['name'] === 'string' ? params['name'] : undefined;
    case 'resources/read':
      return typeof params?.['uri'] === 'string' ? params['uri'] : undefined;
    default:
      return undefined;
  }
}

function spanNameOf(method: string, params: JsonRpcParams | undefined, resourceUriInSpanName: boolean): string {
  if (method === 'resources/read' && !resourceUriInSpanName) return method;
  const target = targetOf(method, params);
  return target === undefined ? method : `${method} ${target}`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return '[unserializable]';
  }
}

/* ------------------------------------------------------------------- state */

interface Pending {
  span: Span;
  method: string;
  /** Sent by this side (`outbound`) or received by it (`inbound`). */
  direction: 'outbound' | 'inbound';
  startedAt: number;
  /** Low-cardinality attributes shared by the span and the duration metric. */
  metricAttributes: Attributes;
}

/** Span attributes that never go on a metric: identifiers and opt-in payloads. */
const NOT_ON_METRICS = new Set<string>([ATTR_JSONRPC_REQUEST_ID, ATTR_MCP_RESOURCE_URI, ATTR_GEN_AI_TOOL_CALL_ARGUMENTS, ATTR_GEN_AI_TOOL_CALL_RESULT]);

function metricAttributesOf(attributes: Attributes): Attributes {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) if (!NOT_ON_METRICS.has(key)) out[key] = value;
  return out;
}

function seconds(sinceMs: number): number {
  return (performance.now() - sinceMs) / 1000;
}

class TransportState {
  /** Spans of the requests this side sent, waiting for a response. */
  readonly outbound = new Map<string, Pending>();
  /** Spans of the requests this side received, waiting for the response to be written. */
  readonly inbound = new Map<string, Pending>();
  negotiatedProtocolVersion: string | undefined;

  private readonly meter: Meter | undefined;
  private histograms: { clientOperation: Histogram; serverOperation: Histogram; session: Histogram } | undefined;
  private sessionStartedAt: number | undefined;
  private sessionRecorded = false;

  constructor(
    readonly role: Role,
    readonly tracer: Tracer,
    readonly propagator: TextMapPropagator,
    readonly options: McpInstrumentationOptions,
    readonly staticAttributes: Attributes,
  ) {
    if (options.instrumentMetrics !== false) this.meter = (options.meterProvider ?? metrics.getMeterProvider()).getMeter(PACKAGE_NAME, PACKAGE_VERSION);
  }

  private instruments() {
    if (this.histograms === undefined && this.meter !== undefined) {
      const advice = { explicitBucketBoundaries: DURATION_BUCKET_BOUNDARIES };
      this.histograms = {
        clientOperation: this.meter.createHistogram(METRIC_MCP_CLIENT_OPERATION_DURATION, { unit: 's', description: 'Duration of an MCP request or notification as observed on the sender', advice }),
        serverOperation: this.meter.createHistogram(METRIC_MCP_SERVER_OPERATION_DURATION, { unit: 's', description: 'Duration of an MCP request or notification as observed on the receiver', advice }),
        session: this.meter.createHistogram(this.role === 'client' ? METRIC_MCP_CLIENT_SESSION_DURATION : METRIC_MCP_SERVER_SESSION_DURATION, { unit: 's', description: 'Duration of an MCP session', advice }),
      };
    }
    return this.histograms;
  }

  pending(span: Span, method: string, direction: 'outbound' | 'inbound', attributes: Attributes): Pending {
    return { span, method, direction, startedAt: performance.now(), metricAttributes: metricAttributesOf(attributes) };
  }

  recordOperation(pending: Pending, extra: Attributes = {}): void {
    const h = this.instruments();
    if (h === undefined) return;
    const attributes = { ...pending.metricAttributes, ...extra };
    (pending.direction === 'outbound' ? h.clientOperation : h.serverOperation).record(seconds(pending.startedAt), attributes);
  }

  sessionStarted(): void {
    this.sessionStartedAt ??= performance.now();
  }

  sessionEnded(): void {
    if (this.sessionRecorded || this.sessionStartedAt === undefined) return;
    this.sessionRecorded = true;
    const h = this.instruments();
    if (h === undefined) return;
    const attributes: Attributes = { ...this.staticAttributes };
    if (this.negotiatedProtocolVersion !== undefined) attributes[ATTR_MCP_PROTOCOL_VERSION] = this.negotiatedProtocolVersion;
    h.session.record(seconds(this.sessionStartedAt), attributes);
  }

  startAttributes(request: JsonRpcRequestLike): Attributes {
    const attributes: Attributes = {
      ...this.staticAttributes,
      [ATTR_MCP_METHOD_NAME]: request.method,
      [ATTR_JSONRPC_REQUEST_ID]: String(request.id),
    };
    // The convention wants jsonrpc.protocol.version only when it is not 2.0.
    if (request.jsonrpc !== '2.0') attributes[ATTR_JSONRPC_PROTOCOL_VERSION] = String(request.jsonrpc);
    const params = request.params;
    const envelopeVersion = params?._meta?.[PROTOCOL_VERSION_META_KEY];
    const version = typeof envelopeVersion === 'string' ? envelopeVersion : this.negotiatedProtocolVersion;
    if (version !== undefined) attributes[ATTR_MCP_PROTOCOL_VERSION] = version;

    const target = targetOf(request.method, params);
    switch (request.method) {
      case 'tools/call':
        if (target !== undefined) attributes[ATTR_GEN_AI_TOOL_NAME] = target;
        attributes[ATTR_GEN_AI_OPERATION_NAME] = GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL;
        if (this.options.captureArguments) attributes[ATTR_GEN_AI_TOOL_CALL_ARGUMENTS] = safeStringify(params?.['arguments'] ?? {});
        break;
      case 'prompts/get':
        if (target !== undefined) attributes[ATTR_GEN_AI_PROMPT_NAME] = target;
        break;
      case 'resources/read':
        if (target !== undefined) attributes[ATTR_MCP_RESOURCE_URI] = target;
        break;
      default:
        break;
    }
    return attributes;
  }

  notificationAttributes(notification: JsonRpcNotificationLike): Attributes {
    const attributes: Attributes = { ...this.staticAttributes, [ATTR_MCP_METHOD_NAME]: notification.method };
    const envelopeVersion = notification.params?._meta?.[PROTOCOL_VERSION_META_KEY];
    const version = typeof envelopeVersion === 'string' ? envelopeVersion : this.negotiatedProtocolVersion;
    if (version !== undefined) attributes[ATTR_MCP_PROTOCOL_VERSION] = version;
    return attributes;
  }

  /** Learn the negotiated revision from an `initialize` result, whichever side we are on. */
  learnProtocolVersion(pending: Pending, message: JsonRpcResultLike | JsonRpcErrorLike): void {
    if (pending.method !== 'initialize' || !('result' in message)) return;
    const version = message.result['protocolVersion'];
    if (typeof version === 'string') this.negotiatedProtocolVersion = version;
  }

  finish(pending: Pending, message: JsonRpcResultLike | JsonRpcErrorLike): void {
    const { span, method } = pending;
    const extra: Attributes = {};
    if ('error' in message) {
      const code = String(message.error.code);
      extra[ATTR_ERROR_TYPE] = code;
      extra[ATTR_RPC_RESPONSE_STATUS_CODE] = code;
      span.setAttributes(extra);
      span.setStatus({ code: SpanStatusCode.ERROR, message: message.error.message });
    } else if (message.result['isError'] === true) {
      extra[ATTR_ERROR_TYPE] = ERROR_TYPE_VALUE_TOOL_ERROR;
      span.setAttributes(extra);
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else if (method === 'tools/call' && this.options.captureResults) {
      span.setAttribute(ATTR_GEN_AI_TOOL_CALL_RESULT, safeStringify(message.result));
    }
    span.end();
    this.recordOperation(pending, extra);
  }

  /** A notification was written or dispatched: no response to wait for. */
  acknowledge(pending: Pending): void {
    pending.span.end();
    this.recordOperation(pending);
  }

  fail(pending: Pending, errorType: string, error?: unknown): void {
    const { span } = pending;
    span.setAttribute(ATTR_ERROR_TYPE, errorType);
    if (error instanceof Error) span.recordException(error);
    span.setStatus(error instanceof Error ? { code: SpanStatusCode.ERROR, message: error.message } : { code: SpanStatusCode.ERROR });
    span.end();
    this.recordOperation(pending, { [ATTR_ERROR_TYPE]: errorType });
  }

  /** A response arrived: settle the span of the request this side sent. */
  settle(message: JsonRpcResultLike | JsonRpcErrorLike): void {
    const key = pendingKey(message.id);
    const pending = this.outbound.get(key);
    if (!pending) return;
    this.outbound.delete(key);
    this.learnProtocolVersion(pending, message);
    this.finish(pending, message);
  }

  closeAll(): void {
    for (const pending of [...this.outbound.values(), ...this.inbound.values()]) this.fail(pending, ERROR_TYPE_VALUE_CONNECTION_CLOSED);
    this.outbound.clear();
    this.inbound.clear();
    this.sessionEnded();
  }
}

/* ----------------------------------------------------------------- helpers */

function detectNetworkTransport(transport: TransportLike): string | undefined {
  const name = (transport as { constructor?: { name?: string } }).constructor?.name ?? '';
  if (/stdio/i.test(name)) return 'pipe';
  if (/http|sse/i.test(name)) return 'tcp';
  return undefined;
}

function resolveState(role: Role, transport: TransportLike, options: McpInstrumentationOptions): TransportState {
  const tracer = (options.tracerProvider ?? trace.getTracerProvider()).getTracer(PACKAGE_NAME, PACKAGE_VERSION);
  const propagator: TextMapPropagator = options.propagator ?? {
    inject: (ctx, carrier, setter) => propagation.inject(ctx, carrier, setter),
    extract: (ctx, carrier, getter) => propagation.extract(ctx, carrier, getter),
    fields: () => propagation.fields(),
  };
  const staticAttributes: Attributes = {};
  const networkTransport = options.networkTransport ?? detectNetworkTransport(transport);
  if (networkTransport !== undefined) staticAttributes[ATTR_NETWORK_TRANSPORT] = networkTransport;
  if (options.serverAddress !== undefined) staticAttributes[ATTR_SERVER_ADDRESS] = options.serverAddress;
  if (options.serverPort !== undefined) staticAttributes[ATTR_SERVER_PORT] = options.serverPort;
  return new TransportState(role, tracer, propagator, options, staticAttributes);
}

const WRAPPED: unique symbol = Symbol.for('mcp-opentelemetry.wrapped');

type Callback = (...args: never[]) => unknown;

function isOurs(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as { [WRAPPED]?: true })[WRAPPED] === true;
}

function tag<F extends Callback>(fn: F): F {
  Object.defineProperty(fn, WRAPPED, { value: true, enumerable: false });
  return fn;
}

/**
 * Replace a callback property by an accessor so that whatever the SDK assigns
 * later (`Protocol.connect()` sets `onmessage` and `onclose`) is wrapped too.
 * Returns a function that re-wraps the current value if another library has
 * replaced the accessor since; it is called from `start()`, which
 * `Protocol.connect()` invokes after assigning its callbacks.
 */
function interceptCallback<K extends 'onmessage' | 'onclose'>(
  transport: TransportLike,
  key: K,
  wrap: (fn: NonNullable<TransportLike[K]>) => NonNullable<TransportLike[K]>,
): () => void {
  const wrapOnce = (fn: TransportLike[K]): TransportLike[K] =>
    fn === undefined || isOurs(fn) ? fn : tag(wrap(fn as NonNullable<TransportLike[K]>) as Callback) as NonNullable<TransportLike[K]>;
  let inner: TransportLike[K] = wrapOnce(transport[key]);
  Object.defineProperty(transport, key, {
    configurable: true,
    enumerable: true,
    get: () => inner,
    set: (fn: TransportLike[K]) => {
      inner = wrapOnce(fn);
    },
  });
  return () => {
    const current = transport[key];
    if (current !== undefined && !isOurs(current)) transport[key] = wrapOnce(current);
  };
}

/** Give the request a `_meta` of its own, never mutating an object the caller may still hold. */
function ownMeta(message: { params?: JsonRpcParams | undefined }): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...message.params?._meta };
  message.params = { ...message.params, _meta: meta };
  return meta;
}

function countBaggagePairs(serialized: unknown): number {
  return typeof serialized === 'string' && serialized.length > 0 ? serialized.split(',').length : 0;
}

/* -------------------------------------------------------------------- peer */

/**
 * Both sides are instrumented the same way, because both sides send and
 * receive requests: the client sends tools/call, the server sends
 * sampling/createMessage or elicitation/create back. An outgoing request opens
 * a CLIENT span and injects into params._meta; an incoming request extracts
 * params._meta and opens a SERVER span active around the dispatch; responses
 * settle the span of the request they answer.
 */
function instrumentAsPeer(transport: TransportLike, state: TransportState): () => void {
  const send = transport.send.bind(transport);
  const notifications = state.options.instrumentNotifications !== false;
  transport.send = (message: JsonRpcMessageLike, options?: unknown): Promise<void> => {
    if (isRequest(message)) return sendRequest(message, options);
    if (isResponse(message)) return sendResponse(message, options);
    if (notifications && isNotification(message)) return sendNotification(message, options);
    return send(message, options);
  };

  function sendNotification(message: JsonRpcNotificationLike, options?: unknown): Promise<void> {
    let parent = context.active();
    if (message.method === 'notifications/cancelled') {
      // A cancellation is sent from the abort handler, outside the context of
      // the call: parent it to the span of the request it cancels.
      const requestId = message.params?.['requestId'];
      const cancelled = typeof requestId === 'string' || typeof requestId === 'number' ? state.outbound.get(pendingKey(requestId)) : undefined;
      if (cancelled !== undefined) {
        parent = trace.setSpan(parent, cancelled.span);
        // The request will get no usable answer: close its span now.
        state.outbound.delete(pendingKey(requestId as RequestId));
        state.fail(cancelled, ERROR_TYPE_VALUE_CANCELLED);
      }
    }
    const attributes = state.notificationAttributes(message);
    const span = state.tracer.startSpan(message.method, { kind: SpanKind.CLIENT, attributes }, parent);
    const pending = state.pending(span, message.method, 'outbound', attributes);
    const ctx = trace.setSpan(parent, span);
    state.propagator.inject(ctx, ownMeta(message), metaSetter);
    return context.with(ctx, () => send(message, options)).then(
      () => state.acknowledge(pending),
      (error: unknown) => {
        state.fail(pending, error instanceof Error ? error.name : 'send_failed', error);
        throw error;
      },
    );
  }

  function sendRequest(message: JsonRpcRequestLike, options?: unknown): Promise<void> {
    const parent = context.active();
    const attributes = state.startAttributes(message);
    const span = state.tracer.startSpan(spanNameOf(message.method, message.params, state.options.resourceUriInSpanName === true), { kind: SpanKind.CLIENT, attributes }, parent);
    const ctx = trace.setSpan(parent, span);
    const meta = ownMeta(message);
    state.propagator.inject(ctx, meta, metaSetter);

    const baggage = propagation.getBaggage(ctx);
    if (baggage !== undefined) {
      const expected = baggage.getAllEntries().length;
      const written = countBaggagePairs(meta[BAGGAGE_META_KEY]);
      if (written < expected) diag.debug(`${PACKAGE_NAME}: ${expected - written} baggage entries dropped by the propagator limits on ${message.method}`);
    }

    const pending = state.pending(span, message.method, 'outbound', attributes);
    const key = pendingKey(message.id);
    state.outbound.set(key, pending);
    return context.with(ctx, () => send(message, options)).catch((error: unknown) => {
      if (state.outbound.delete(key)) state.fail(pending, error instanceof Error ? error.name : 'send_failed', error);
      throw error;
    });
  }

  function sendResponse(message: JsonRpcResultLike | JsonRpcErrorLike, options?: unknown): Promise<void> {
    const key = pendingKey(message.id);
    const pending = state.inbound.get(key);
    if (!pending) return send(message, options);
    state.inbound.delete(key);
    state.learnProtocolVersion(pending, message);
    return send(message, options).then(
      () => state.finish(pending, message),
      (error: unknown) => {
        state.fail(pending, error instanceof Error ? error.name : 'send_failed', error);
        throw error;
      },
    );
  }

  return interceptCallback(transport, 'onmessage', (fn) => (message: JsonRpcMessageLike, extra?: unknown) => {
    if (isRequest(message)) return receiveRequest(message, extra, fn);
    if (isResponse(message)) state.settle(message);
    else if (notifications && isNotification(message)) return receiveNotification(message, extra, fn);
    return fn(message, extra);
  });

  /** Parent per the convention: the carried context, with the ambient context as a link; else the ambient context. */
  function inboundParent(message: { params?: JsonRpcParams | undefined }): { parent: Context; links: Link[] } {
    const ambient = context.active();
    const meta = message.params?._meta;
    const extracted = meta !== undefined && meta !== null && typeof meta === 'object' ? state.propagator.extract(ROOT_CONTEXT, meta, metaGetter) : ROOT_CONTEXT;
    const remote = trace.getSpanContext(extracted);
    const ambientSpan = trace.getSpanContext(ambient);
    const links: Link[] = [];
    if (remote !== undefined && trace.isSpanContextValid(remote)) {
      if (ambientSpan !== undefined && trace.isSpanContextValid(ambientSpan)) links.push({ context: ambientSpan });
      return { parent: extracted, links };
    }
    const baggage = propagation.getBaggage(extracted);
    return { parent: baggage !== undefined ? propagation.setBaggage(ambient, baggage) : ambient, links };
  }

  function receiveNotification(message: JsonRpcNotificationLike, extra: unknown, fn: NonNullable<TransportLike['onmessage']>): unknown {
    const { parent, links } = inboundParent(message);
    const attributes = state.notificationAttributes(message);
    const span = state.tracer.startSpan(message.method, { kind: SpanKind.SERVER, attributes, links }, parent);
    const pending = state.pending(span, message.method, 'inbound', attributes);
    const ctx = trace.setSpan(parent, span);
    state.propagator.inject(ctx, ownMeta(message), metaSetter);
    try {
      return context.with(ctx, () => fn(message, extra));
    } finally {
      // The SDK hands notifications to their handler in a later microtask;
      // the span covers the dispatch, not the handler.
      state.acknowledge(pending);
    }
  }

  function receiveRequest(message: JsonRpcRequestLike, extra: unknown, fn: NonNullable<TransportLike['onmessage']>): unknown {
    const { parent, links } = inboundParent(message);
    const attributes = state.startAttributes(message);
    const span = state.tracer.startSpan(spanNameOf(message.method, message.params, state.options.resourceUriInSpanName === true), { kind: SpanKind.SERVER, attributes, links }, parent);
    state.inbound.set(pendingKey(message.id), state.pending(span, message.method, 'inbound', attributes));
    const ctx = trace.setSpan(parent, span);

    // Rewrite the carried context so that it names the server span. Anything
    // downstream that extracts `_meta` again, a second instrumentation or a
    // handler forwarding the request, then parents under this span instead of
    // under the caller's span. The trace id does not change.
    state.propagator.inject(ctx, ownMeta(message), metaSetter);

    return context.with(ctx, () => fn(message, extra));
  }
}

/* ------------------------------------------------------------------ public */

function instrumentTransport<T extends TransportLike>(transport: T, role: Role, options: McpInstrumentationOptions): T {
  if (isInstrumented(transport)) return transport;
  const state = resolveState(role, transport, options);
  const reattachMessage = instrumentAsPeer(transport, state);
  const reattachClose = interceptCallback(transport, 'onclose', (fn) => () => {
    state.closeAll();
    return fn();
  });
  // Protocol.connect() assigns its callbacks, then calls start(): the last
  // chance to make sure our wrappers still sit around the dispatch.
  const start = transport.start.bind(transport);
  transport.start = () => {
    reattachMessage();
    reattachClose();
    state.sessionStarted();
    return start();
  };
  const close = transport.close.bind(transport);
  transport.close = () => close().finally(() => state.closeAll());
  Object.defineProperty(transport, INSTRUMENTED, { value: role, enumerable: false, configurable: true });
  return transport;
}

/** Instrument a transport that a `Client` will connect to. Returns the same object. */
export function instrumentClientTransport<T extends TransportLike>(transport: T, options: McpInstrumentationOptions = {}): T {
  return instrumentTransport(transport, 'client', options);
}

/** Instrument a transport that a `Server` or `McpServer` will connect to. Returns the same object. */
export function instrumentServerTransport<T extends TransportLike>(transport: T, options: McpInstrumentationOptions = {}): T {
  return instrumentTransport(transport, 'server', options);
}

function patchConnect(target: Connectable, role: Role, options: McpInstrumentationOptions): void {
  const marked = target as Connectable & { [CONNECT_PATCHED]?: true };
  if (marked[CONNECT_PATCHED]) return;
  const original = target.connect;
  target.connect = function (this: Connectable, transport: TransportLike, ...rest: unknown[]) {
    return original.call(this, instrumentTransport(transport, role, options), ...rest);
  };
  Object.defineProperty(target, CONNECT_PATCHED, { value: true, enumerable: false, configurable: true });
}

/** Patch `client.connect` so that every transport it connects to is instrumented. Returns the same object. */
export function instrumentClient<T extends Connectable>(client: T, options: McpInstrumentationOptions = {}): T {
  patchConnect(client, 'client', options);
  return client;
}

/**
 * Patch `server.connect` so that every transport it connects to is instrumented.
 * Works for `Server` and `McpServer`; the inner `server` of an `McpServer` is
 * patched too, because `createMcpHandler` connects through it. Returns the same object.
 */
export function instrumentServer<T extends Connectable>(server: T, options: McpInstrumentationOptions = {}): T {
  patchConnect(server, 'server', options);
  const inner = (server as { server?: unknown }).server;
  if (inner !== null && typeof inner === 'object' && typeof (inner as Connectable).connect === 'function') patchConnect(inner as Connectable, 'server', options);
  return server;
}
