import {
  context,
  diag,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Link,
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
} from './semconv.js';
import type {
  Connectable,
  JsonRpcErrorLike,
  JsonRpcMessageLike,
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
}

export type Role = 'client' | 'server';

/** Error class recorded when a transport closes while requests are in flight. */
export const ERROR_TYPE_VALUE_CONNECTION_CLOSED = 'connection_closed';

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

function spanNameOf(method: string, params: JsonRpcParams | undefined): string {
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
}

class TransportState {
  readonly pending = new Map<string, Pending>();
  negotiatedProtocolVersion: string | undefined;

  constructor(
    readonly role: Role,
    readonly tracer: Tracer,
    readonly propagator: TextMapPropagator,
    readonly options: McpInstrumentationOptions,
    readonly staticAttributes: Attributes,
  ) {}

  startAttributes(request: JsonRpcRequestLike): Attributes {
    const attributes: Attributes = {
      ...this.staticAttributes,
      [ATTR_MCP_METHOD_NAME]: request.method,
      [ATTR_JSONRPC_REQUEST_ID]: String(request.id),
      [ATTR_JSONRPC_PROTOCOL_VERSION]: '2.0',
    };
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

  /** Learn the negotiated revision from an `initialize` result, whichever side we are on. */
  learnProtocolVersion(pending: Pending, message: JsonRpcResultLike | JsonRpcErrorLike): void {
    if (pending.method !== 'initialize' || !('result' in message)) return;
    const version = message.result['protocolVersion'];
    if (typeof version === 'string') this.negotiatedProtocolVersion = version;
  }

  finish(pending: Pending, message: JsonRpcResultLike | JsonRpcErrorLike): void {
    const { span, method } = pending;
    if ('error' in message) {
      const code = String(message.error.code);
      span.setAttribute(ATTR_ERROR_TYPE, code);
      span.setAttribute(ATTR_RPC_RESPONSE_STATUS_CODE, code);
      span.setStatus({ code: SpanStatusCode.ERROR, message: message.error.message });
    } else if (message.result['isError'] === true) {
      span.setAttribute(ATTR_ERROR_TYPE, ERROR_TYPE_VALUE_TOOL_ERROR);
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else if (method === 'tools/call' && this.options.captureResults) {
      span.setAttribute(ATTR_GEN_AI_TOOL_CALL_RESULT, safeStringify(message.result));
    }
    span.end();
  }

  fail(pending: Pending, errorType: string, error?: unknown): void {
    const { span } = pending;
    span.setAttribute(ATTR_ERROR_TYPE, errorType);
    if (error instanceof Error) span.recordException(error);
    span.setStatus(error instanceof Error ? { code: SpanStatusCode.ERROR, message: error.message } : { code: SpanStatusCode.ERROR });
    span.end();
  }

  settle(message: JsonRpcMessageLike): void {
    if (!isResponse(message)) return;
    const key = pendingKey(message.id);
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    this.learnProtocolVersion(pending, message);
    this.finish(pending, message);
  }

  closeAll(): void {
    for (const pending of this.pending.values()) this.fail(pending, ERROR_TYPE_VALUE_CONNECTION_CLOSED);
    this.pending.clear();
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
function ownMeta(request: JsonRpcRequestLike): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...request.params?._meta };
  request.params = { ...request.params, _meta: meta };
  return meta;
}

function countBaggagePairs(serialized: unknown): number {
  return typeof serialized === 'string' && serialized.length > 0 ? serialized.split(',').length : 0;
}

/* ------------------------------------------------------------------ client */

function instrumentAsClient(transport: TransportLike, state: TransportState): () => void {
  const send = transport.send.bind(transport);
  transport.send = (message: JsonRpcMessageLike, options?: unknown): Promise<void> => {
    if (!isRequest(message)) return send(message, options);

    const parent = context.active();
    const span = state.tracer.startSpan(spanNameOf(message.method, message.params), { kind: SpanKind.CLIENT, attributes: state.startAttributes(message) }, parent);
    const ctx = trace.setSpan(parent, span);
    const meta = ownMeta(message);
    state.propagator.inject(ctx, meta, metaSetter);

    const baggage = propagation.getBaggage(ctx);
    if (baggage !== undefined) {
      const expected = baggage.getAllEntries().length;
      const written = countBaggagePairs(meta[BAGGAGE_META_KEY]);
      if (written < expected) diag.debug(`${PACKAGE_NAME}: ${expected - written} baggage entries dropped by the propagator limits on ${message.method}`);
    }

    const pending: Pending = { span, method: message.method };
    state.pending.set(pendingKey(message.id), pending);
    return context.with(ctx, () => send(message, options)).catch((error: unknown) => {
      if (state.pending.delete(pendingKey(message.id))) state.fail(pending, error instanceof Error ? error.name : 'send_failed', error);
      throw error;
    });
  };

  return interceptCallback(transport, 'onmessage', (fn) => (message: JsonRpcMessageLike, extra?: unknown) => {
    state.settle(message);
    return fn(message, extra);
  });
}

/* ------------------------------------------------------------------ server */

function instrumentAsServer(transport: TransportLike, state: TransportState): () => void {
  const reattach = interceptCallback(transport, 'onmessage', (fn) => (message: JsonRpcMessageLike, extra?: unknown) => {
    if (!isRequest(message)) return fn(message, extra);

    const ambient = context.active();
    const meta = message.params?._meta;
    const extracted = meta !== undefined && meta !== null && typeof meta === 'object' ? state.propagator.extract(ROOT_CONTEXT, meta, metaGetter) : ROOT_CONTEXT;

    // Parenting rule of the convention: the context carried by `_meta` is the
    // parent; an ambient context (an incoming HTTP request) becomes a link.
    // Without a valid carried context, the ambient context is the parent.
    const remote = trace.getSpanContext(extracted);
    const ambientSpan = trace.getSpanContext(ambient);
    let parent: Context;
    const links: Link[] = [];
    if (remote !== undefined && trace.isSpanContextValid(remote)) {
      parent = extracted;
      if (ambientSpan !== undefined && trace.isSpanContextValid(ambientSpan)) links.push({ context: ambientSpan });
    } else {
      parent = ambient;
      const baggage = propagation.getBaggage(extracted);
      if (baggage !== undefined) parent = propagation.setBaggage(parent, baggage);
    }

    const span = state.tracer.startSpan(spanNameOf(message.method, message.params), { kind: SpanKind.SERVER, attributes: state.startAttributes(message), links }, parent);
    state.pending.set(pendingKey(message.id), { span, method: message.method });
    const ctx = trace.setSpan(parent, span);

    // Rewrite the carried context so that it names the server span. Anything
    // downstream that extracts `_meta` again, a second instrumentation or a
    // handler forwarding the request, then parents under this span instead of
    // under the caller's span. The trace id does not change.
    state.propagator.inject(ctx, ownMeta(message), metaSetter);

    return context.with(ctx, () => fn(message, extra));
  });

  const send = transport.send.bind(transport);
  transport.send = (message: JsonRpcMessageLike, options?: unknown): Promise<void> => {
    if (!isResponse(message)) return send(message, options);
    const key = pendingKey(message.id);
    const pending = state.pending.get(key);
    if (!pending) return send(message, options);
    state.pending.delete(key);
    state.learnProtocolVersion(pending, message);
    return send(message, options).then(
      () => state.finish(pending, message),
      (error: unknown) => {
        state.fail(pending, error instanceof Error ? error.name : 'send_failed', error);
        throw error;
      },
    );
  };
  return reattach;
}

/* ------------------------------------------------------------------ public */

function instrumentTransport<T extends TransportLike>(transport: T, role: Role, options: McpInstrumentationOptions): T {
  if (isInstrumented(transport)) return transport;
  const state = resolveState(role, transport, options);
  const reattachMessage = role === 'client' ? instrumentAsClient(transport, state) : instrumentAsServer(transport, state);
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
