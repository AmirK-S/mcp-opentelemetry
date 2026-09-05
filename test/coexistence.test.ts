/**
 * Coexistence with a propagation-only instrumentation, such as
 * `@arizeai/openinference-instrumentation-mcp`, which injects the active
 * context into `params._meta` on `send` and extracts it on `onmessage`
 * without opening spans. Whatever the order of application, the wire must
 * carry a single traceparent that names the span really in flight.
 */
import { context, propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import { afterEach, describe, expect, it } from 'vitest';
import { instrumentClientTransport, instrumentServerTransport } from '../src/index.js';
import { TRACEPARENT_META_KEY } from '../src/keys.js';
import type { JsonRpcMessageLike, TransportLike } from '../src/types.js';
import { connectedPair, findRequest, metaOf, parseTraceparent, setupOtel, type OtelHarness, type Pair } from './helpers.js';

/** A faithful reduction of what OpenInference does. */
function propagationOnly(transport: TransportLike, otel: OtelHarness): TransportLike {
  const send = transport.send.bind(transport);
  transport.send = (message: JsonRpcMessageLike, options?: unknown) => {
    if ('method' in message && 'id' in message) {
      message.params = message.params ?? {};
      message.params._meta = message.params._meta ?? {};
      otel.propagator.inject(context.active(), message.params._meta, {
        set: (carrier, key, value) => {
          (carrier as Record<string, unknown>)[key] = value;
        },
      });
    }
    return send(message, options);
  };
  const previous = transport.onmessage;
  const wrap = (fn: NonNullable<TransportLike['onmessage']> | undefined) =>
    fn === undefined
      ? undefined
      : (message: JsonRpcMessageLike, extra?: unknown) => {
          if ('method' in message && 'id' in message && message.params?._meta) {
            const ctx = otel.propagator.extract(ROOT_CONTEXT, message.params._meta, {
              get: (carrier, key) => (carrier as Record<string, string>)[key],
              keys: (carrier) => Object.keys(carrier as object),
            });
            return context.with(ctx, () => fn(message, extra));
          }
          return fn(message, extra);
        };
  let inner = wrap(previous);
  Object.defineProperty(transport, 'onmessage', {
    configurable: true,
    enumerable: true,
    get: () => inner,
    set: (fn) => {
      inner = wrap(fn);
    },
  });
  return transport;
}

let pair: Pair | undefined;
afterEach(async () => {
  await pair?.close();
  pair = undefined;
});

describe('coexistence with a propagation-only instrumentation', () => {
  it.each([
    ['applied before this package', (t: TransportLike, otel: OtelHarness) => instrumentClientTransport(propagationOnly(t, otel), otel.options)],
    ['applied after this package', (t: TransportLike, otel: OtelHarness) => propagationOnly(instrumentClientTransport(t, otel.options), otel)],
  ])('client side, %s: one traceparent, naming the client span', async (_label, apply) => {
    const otel = setupOtel();
    pair = await connectedPair({
      instrumentClient: (t) => apply(t, otel),
      instrumentServer: (t) => instrumentServerTransport(t, otel.options),
    });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    const clientSpans = otel.clientSpans().filter((s) => s.name === 'tools/call echo');
    expect(clientSpans).toHaveLength(1);
    const meta = metaOf(findRequest(pair.wire, 'tools/call'))!;
    expect(Object.keys(meta).filter((k) => k === TRACEPARENT_META_KEY)).toHaveLength(1);
    const tp = parseTraceparent(meta[TRACEPARENT_META_KEY]);
    expect(tp.spanId).toBe(clientSpans[0]!.spanContext().spanId);
    const serverSpan = otel.serverSpans().find((s) => s.name === 'tools/call echo')!;
    expect(serverSpan.parentSpanContext?.spanId).toBe(clientSpans[0]!.spanContext().spanId);
  });

  it.each([
    ['applied before this package', (t: TransportLike, otel: OtelHarness) => instrumentServerTransport(propagationOnly(t, otel), otel.options)],
    ['applied after this package', (t: TransportLike, otel: OtelHarness) => propagationOnly(instrumentServerTransport(t, otel.options), otel)],
  ])('server side, %s: one server span, parented to the client span', async (_label, apply) => {
    const otel = setupOtel();
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, otel.options),
      instrumentServer: (t) => apply(t, otel),
    });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    const clientSpan = otel.clientSpans().find((s) => s.name === 'tools/call echo')!;
    const serverSpans = otel.serverSpans().filter((s) => s.name === 'tools/call echo');
    expect(serverSpans).toHaveLength(1);
    expect(serverSpans[0]!.parentSpanContext?.spanId).toBe(clientSpan.spanContext().spanId);
    expect(pair.observed[0]!.activeSpan?.spanContext().spanId).toBe(serverSpans[0]!.spanContext().spanId);
  });

  it('does not add a baggage key when there is no baggage', async () => {
    const otel = setupOtel();
    pair = await connectedPair({ instrumentClient: (t) => instrumentClientTransport(t, otel.options) });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    const meta = metaOf(findRequest(pair.wire, 'tools/call'))!;
    expect(meta['baggage']).toBeUndefined();
    expect(propagation.getBaggage(context.active())).toBeUndefined();
  });
});
