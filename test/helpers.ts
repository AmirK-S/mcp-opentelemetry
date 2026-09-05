/**
 * Shared test harness: an OpenTelemetry pipeline with an in-memory exporter,
 * and an MCP client and server linked by the in-memory transport of the SDK.
 *
 * The in-memory transport delivers messages synchronously, so without care
 * the server would run inside the client's async context and propagation
 * would appear to work by leakage. `isolate()` cuts that leak: every
 * delivery happens in a fresh context, as it would across a real process
 * boundary. It is applied before instrumentation so it sits closest to the
 * wire.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { context, propagation, ROOT_CONTEXT, trace, type Context, type Span, type TextMapPropagator } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { McpInstrumentationOptions } from '../src/index.js';
import type { JsonRpcMessageLike, TransportLike } from '../src/types.js';

let contextManagerInstalled = false;
export function installContextManager(): void {
  if (contextManagerInstalled) return;
  const manager = new AsyncLocalStorageContextManager();
  manager.enable();
  context.setGlobalContextManager(manager);
  contextManagerInstalled = true;
}

export interface OtelHarness {
  exporter: InMemorySpanExporter;
  provider: BasicTracerProvider;
  propagator: TextMapPropagator;
  options: McpInstrumentationOptions;
  spans(): ReadableSpan[];
  clientSpans(): ReadableSpan[];
  serverSpans(): ReadableSpan[];
  startSpan(name: string): Span;
}

export function setupOtel(extra: Partial<McpInstrumentationOptions> = {}): OtelHarness {
  installContextManager();
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const propagator = new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  });
  const options: McpInstrumentationOptions = { tracerProvider: provider, propagator, ...extra };
  return {
    exporter,
    provider,
    propagator,
    options,
    spans: () => exporter.getFinishedSpans(),
    clientSpans: () => exporter.getFinishedSpans().filter((s) => s.kind === 2 /* SpanKind.CLIENT */),
    serverSpans: () => exporter.getFinishedSpans().filter((s) => s.kind === 1 /* SpanKind.SERVER */),
    startSpan: (name) => provider.getTracer('test').startSpan(name),
  };
}

/** Records what crosses the wire, in both directions. */
export interface Wire {
  clientToServer: JsonRpcMessageLike[];
  serverToClient: JsonRpcMessageLike[];
}

/**
 * Deliver every message in a detached context (or in `ambient` when given),
 * and record it. Must be applied before instrumentation.
 */
export function isolate(transport: TransportLike, sink: JsonRpcMessageLike[], ambient?: () => Context): void {
  const send = transport.send.bind(transport);
  transport.send = (message: JsonRpcMessageLike, options?: unknown) => {
    sink.push(structuredClone(message));
    const target = ambient ? ambient() : ROOT_CONTEXT;
    return context.with(target, () => send(message, options));
  };
}

export interface HandlerObservation {
  meta: Record<string, unknown> | undefined;
  activeSpan: Span | undefined;
  baggageEntries: Record<string, string>;
  childSpan: Span | undefined;
}

export interface PairOptions {
  instrumentClient?: (t: TransportLike) => TransportLike;
  instrumentServer?: (t: TransportLike) => TransportLike;
  /** Context to activate on the server side while a message is delivered. */
  serverAmbient?: () => Context;
  /** Delay of the `slow` tool in milliseconds. */
  slowMs?: number;
}

export interface Pair {
  client: Client;
  server: McpServer;
  clientTransport: TransportLike;
  serverTransport: TransportLike;
  wire: Wire;
  observed: HandlerObservation[];
  negotiatedProtocolVersion(): string | undefined;
  close(): Promise<void>;
}

const als = new AsyncLocalStorage<string>();
export { als };

/** Build a server with a few tools, link it to a client, connect both. */
export async function connectedPair(options: PairOptions = {}, harness?: OtelHarness): Promise<Pair> {
  const observed: HandlerObservation[] = [];
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  const tracer = (harness?.provider ?? trace.getTracerProvider()).getTracer('tool');

  const observe = (ctx: { mcpReq?: { _meta?: Record<string, unknown> } }): HandlerObservation => {
    const baggage = propagation.getBaggage(context.active());
    const entries: Record<string, string> = {};
    for (const [k, v] of baggage?.getAllEntries() ?? []) entries[k] = v.value;
    const child = tracer.startSpan('inside-tool');
    child.end();
    const obs: HandlerObservation = {
      meta: ctx.mcpReq?._meta,
      activeSpan: trace.getSpan(context.active()),
      baggageEntries: entries,
      childSpan: child,
    };
    observed.push(obs);
    return obs;
  };

  server.registerTool(
    'echo',
    { description: 'Echoes its input', inputSchema: { text: z.string() } },
    async (args, ctx) => {
      observe(ctx as never);
      await new Promise((r) => setTimeout(r, 1));
      return { content: [{ type: 'text', text: `echo: ${args.text}` }] };
    },
  );
  server.registerTool(
    'fail',
    { description: 'Returns a tool error', inputSchema: {} },
    async (_args, ctx) => {
      observe(ctx as never);
      return { content: [{ type: 'text', text: 'boom' }], isError: true };
    },
  );
  server.registerTool(
    'slow',
    { description: 'Takes a while', inputSchema: {} },
    async (_args, ctx) => {
      observe(ctx as never);
      await new Promise((r) => setTimeout(r, options.slowMs ?? 200));
      return { content: [{ type: 'text', text: 'done' }] };
    },
  );

  const [rawClientTransport, rawServerTransport] = InMemoryTransport.createLinkedPair();
  const wire: Wire = { clientToServer: [], serverToClient: [] };
  isolate(rawClientTransport, wire.clientToServer, options.serverAmbient);
  isolate(rawServerTransport, wire.serverToClient);
  const clientTransport = options.instrumentClient ? options.instrumentClient(rawClientTransport) : rawClientTransport;
  const serverTransport = options.instrumentServer ? options.instrumentServer(rawServerTransport) : rawServerTransport;

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport as never), client.connect(clientTransport as never)]);

  return {
    client,
    server,
    clientTransport,
    serverTransport,
    wire,
    observed,
    negotiatedProtocolVersion: () => {
      const init = wire.serverToClient.find((m) => 'result' in m && typeof (m.result as { protocolVersion?: unknown }).protocolVersion === 'string');
      return init && 'result' in init ? (init.result as { protocolVersion: string }).protocolVersion : undefined;
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function findRequest(wire: Wire, method: string): JsonRpcMessageLike | undefined {
  return wire.clientToServer.find((m) => 'method' in m && m.method === method && 'id' in m);
}

export function metaOf(message: JsonRpcMessageLike | undefined): Record<string, unknown> | undefined {
  if (!message || !('params' in message)) return undefined;
  return message.params?._meta;
}

export const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function parseTraceparent(value: unknown): { traceId: string; spanId: string; flags: string } {
  if (typeof value !== 'string') throw new Error(`traceparent is not a string: ${String(value)}`);
  const m = TRACEPARENT_RE.exec(value);
  if (!m) throw new Error(`traceparent has an invalid format: ${value}`);
  return { traceId: m[1]!, spanId: m[2]!, flags: m[3]! };
}
