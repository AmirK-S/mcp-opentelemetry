/**
 * Notifications. The convention asks for the context to be injected into
 * params._meta of notifications too, and for a CLIENT span on the emitter and
 * a SERVER span on the receiver, named after the method.
 */
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it } from 'vitest';
import { instrumentClientTransport, instrumentServerTransport } from '../src/index.js';
import { TRACEPARENT_META_KEY } from '../src/keys.js';
import { ATTR_ERROR_TYPE, ATTR_JSONRPC_REQUEST_ID, ATTR_MCP_METHOD_NAME } from '../src/semconv.js';
import { connectedPair, metaOf, parseTraceparent, setupOtel, type Pair } from './helpers.js';

let pair: Pair | undefined;
afterEach(async () => {
  await pair?.close();
  pair = undefined;
});

describe('notifications/progress', () => {
  async function runProgress() {
    const otel = setupOtel();
    pair = await connectedPair(
      {
        instrumentClient: (t) => instrumentClientTransport(t, otel.options),
        instrumentServer: (t) => instrumentServerTransport(t, otel.options),
        slowMs: 60,
      },
      otel,
    );
    const agent = otel.startSpan('agent');
    const progress: number[] = [];
    await context.with(trace.setSpan(context.active(), agent), () =>
      pair!.client.callTool({ name: 'slow', arguments: {} }, { onprogress: (p) => progress.push(p.progress) }),
    );
    agent.end();
    await new Promise((r) => setImmediate(r));
    expect(progress).toEqual([1, 2, 3]);
    const toolServerSpan = otel.serverSpans().find((s) => s.name === 'tools/call slow')!;
    const wireNotifications = pair.wire.serverToClient.filter((m) => 'method' in m && m.method === 'notifications/progress');
    const emitted = otel.clientSpans().filter((s) => s.name === 'notifications/progress');
    const received = otel.serverSpans().filter((s) => s.name === 'notifications/progress');
    return { otel, agent, toolServerSpan, wireNotifications, emitted, received };
  }

  it('carries the traceparent of the server span that emits it', async () => {
    const { agent, toolServerSpan, wireNotifications, emitted } = await runProgress();
    expect(wireNotifications).toHaveLength(3);
    expect(emitted).toHaveLength(3);
    for (const [i, n] of wireNotifications.entries()) {
      const tp = parseTraceparent(metaOf(n)?.[TRACEPARENT_META_KEY]);
      expect(tp.traceId).toBe(agent.spanContext().traceId);
      expect(tp.spanId).toBe(emitted[i]!.spanContext().spanId);
      expect((n as { params?: { progressToken?: unknown } }).params?.progressToken).toBeDefined();
    }
    for (const s of emitted) expect(s.parentSpanContext?.spanId).toBe(toolServerSpan.spanContext().spanId);
  });

  it('produces a CLIENT span on the emitter and a SERVER span on the receiver, named after the method', async () => {
    const { emitted, received } = await runProgress();
    expect(emitted.every((s) => s.kind === SpanKind.CLIENT)).toBe(true);
    expect(received).toHaveLength(3);
    for (const [i, s] of received.entries()) {
      expect(s.kind).toBe(SpanKind.SERVER);
      expect(s.parentSpanContext?.spanId).toBe(emitted[i]!.spanContext().spanId);
      expect(s.attributes[ATTR_MCP_METHOD_NAME]).toBe('notifications/progress');
      expect(s.attributes[ATTR_JSONRPC_REQUEST_ID]).toBeUndefined();
    }
  });
});

describe('notifications/cancelled', () => {
  it('carries a traceparent in the trace of the cancelled request, parented to the request span', async () => {
    const otel = setupOtel();
    pair = await connectedPair(
      {
        instrumentClient: (t) => instrumentClientTransport(t, otel.options),
        instrumentServer: (t) => instrumentServerTransport(t, otel.options),
        slowMs: 500,
      },
      otel,
    );
    const agent = otel.startSpan('agent');
    const controller = new AbortController();
    const call = context.with(trace.setSpan(context.active(), agent), () =>
      pair!.client.callTool({ name: 'slow', arguments: {} }, { signal: controller.signal }).catch((e: unknown) => e),
    );
    await new Promise((r) => setTimeout(r, 30));
    controller.abort();
    await call;
    agent.end();
    await new Promise((r) => setTimeout(r, 50));

    const wire = pair.wire.clientToServer.find((m) => 'method' in m && m.method === 'notifications/cancelled');
    expect(wire).toBeDefined();
    const tp = parseTraceparent(metaOf(wire)?.[TRACEPARENT_META_KEY]);
    expect(tp.traceId).toBe(agent.spanContext().traceId);

    const emitted = otel.clientSpans().find((s) => s.name === 'notifications/cancelled')!;
    expect(emitted).toBeDefined();
    expect(tp.spanId).toBe(emitted.spanContext().spanId);
    const requestSpan = otel.clientSpans().find((s) => s.name === 'tools/call slow')!;
    expect(requestSpan, 'the cancelled request span is closed at cancellation').toBeDefined();
    expect(requestSpan.status.code).toBe(SpanStatusCode.ERROR);
    expect(requestSpan.attributes[ATTR_ERROR_TYPE]).toBe('cancelled');
    expect(emitted.parentSpanContext?.spanId).toBe(requestSpan.spanContext().spanId);

    const received = otel.serverSpans().find((s) => s.name === 'notifications/cancelled')!;
    expect(received).toBeDefined();
    expect(received.parentSpanContext?.spanId).toBe(emitted.spanContext().spanId);
  });
});

describe('notifications without params', () => {
  it('get a _meta with the context but no other params', async () => {
    const otel = setupOtel();
    pair = await connectedPair({ instrumentClient: (t) => instrumentClientTransport(t, otel.options) });
    const initialized = pair.wire.clientToServer.find((m) => 'method' in m && m.method === 'notifications/initialized');
    expect(initialized).toBeDefined();
    const meta = metaOf(initialized);
    expect(typeof meta?.[TRACEPARENT_META_KEY]).toBe('string');
    expect(Object.keys((initialized as { params?: object }).params ?? {})).toEqual(['_meta']);
  });
});
