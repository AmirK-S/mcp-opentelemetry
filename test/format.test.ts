/**
 * Format tests on `traceparent`, `tracestate` and `baggage` received by an
 * instrumented server. Each malformed value must fall back to the ambient
 * context, never orphan the span, never throw, never fail the call.
 * The rules are those of W3C Trace Context, Recommendation of 23/11/2021.
 */
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it } from 'vitest';
import { instrumentServerTransport } from '../src/index.js';
import { BAGGAGE_META_KEY, TRACEPARENT_META_KEY, TRACESTATE_META_KEY } from '../src/keys.js';
import { connectedPair, setupOtel, type Pair } from './helpers.js';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const PARENT_ID = 'b7ad6b7169203331';
const VALID = `00-${TRACE_ID}-${PARENT_ID}-01`;

let pair: Pair | undefined;
afterEach(async () => {
  await pair?.close();
  pair = undefined;
});

async function callWithMeta(meta: Record<string, unknown>, ambient?: () => ReturnType<typeof context.active>) {
  const otel = setupOtel();
  pair = await connectedPair({
    instrumentServer: (t) => instrumentServerTransport(t, otel.options),
    ...(ambient ? { serverAmbient: ambient } : {}),
  });
  const result = await pair.client.callTool({ name: 'echo', arguments: { text: 'ok' }, _meta: meta });
  const spans = otel.serverSpans().filter((s) => s.name === 'tools/call echo');
  expect(spans).toHaveLength(1);
  const span = spans[0]!;
  expect(span.status.code).not.toBe(SpanStatusCode.ERROR);
  expect(result.content).toEqual([{ type: 'text', text: 'echo: ok' }]);
  return { otel, span, observed: pair.observed[0]! };
}

describe('traceparent', () => {
  it('continues the trace when valid', async () => {
    const { span } = await callWithMeta({ [TRACEPARENT_META_KEY]: VALID });
    expect(span.spanContext().traceId).toBe(TRACE_ID);
    expect(span.parentSpanContext?.spanId).toBe(PARENT_ID);
    expect(span.parentSpanContext?.isRemote).toBe(true);
  });

  it('continues the trace on a higher, well formed version, as W3C requires', async () => {
    const { span } = await callWithMeta({ [TRACEPARENT_META_KEY]: `01-${TRACE_ID}-${PARENT_ID}-01` });
    expect(span.spanContext().traceId).toBe(TRACE_ID);
    expect(span.parentSpanContext?.spanId).toBe(PARENT_ID);
  });

  const invalid: Array<[string, unknown]> = [
    ['version ff', `ff-${TRACE_ID}-${PARENT_ID}-01`],
    ['all-zero trace_id', `00-${'0'.repeat(32)}-${PARENT_ID}-01`],
    ['all-zero parent_id', `00-${TRACE_ID}-${'0'.repeat(16)}-01`],
    ['trace_id too short', `00-${TRACE_ID.slice(1)}-${PARENT_ID}-01`],
    ['parent_id too long', `00-${TRACE_ID}-${PARENT_ID}0-01`],
    ['non hex characters', `00-${'g'.repeat(32)}-${PARENT_ID}-01`],
    ['garbage', 'not-a-traceparent'],
    ['empty string', ''],
    ['a number', 42],
    ['an array', [VALID]],
    ['an object', { value: VALID }],
    ['null', null],
  ];

  it.each(invalid)('falls back to a new trace when %s and nothing is ambient', async (_label, value) => {
    const { span } = await callWithMeta({ [TRACEPARENT_META_KEY]: value });
    expect(span.spanContext().traceId).not.toBe(TRACE_ID);
    expect(span.parentSpanContext).toBeUndefined();
  });

  it.each(invalid)('falls back to the ambient context when %s', async (_label, value) => {
    const otel = setupOtel();
    const ambient = otel.startSpan('ambient');
    const { span } = await callWithMeta({ [TRACEPARENT_META_KEY]: value }, () => trace.setSpan(context.active(), ambient));
    ambient.end();
    expect(span.spanContext().traceId).toBe(ambient.spanContext().traceId);
    expect(span.parentSpanContext?.spanId).toBe(ambient.spanContext().spanId);
    expect(span.links).toHaveLength(0);
  });
});

describe('tracestate', () => {
  it('is carried into the server span when valid', async () => {
    const { span } = await callWithMeta({ [TRACEPARENT_META_KEY]: VALID, [TRACESTATE_META_KEY]: 'vendor=opaque,other=1' });
    expect(span.spanContext().traceState?.get('vendor')).toBe('opaque');
    expect(span.spanContext().traceState?.get('other')).toBe('1');
  });

  it('does not break the trace when it has more than 32 entries', async () => {
    const tooMany = Array.from({ length: 40 }, (_, i) => `k${i}=v${i}`).join(',');
    const { span } = await callWithMeta({ [TRACEPARENT_META_KEY]: VALID, [TRACESTATE_META_KEY]: tooMany });
    expect(span.spanContext().traceId).toBe(TRACE_ID);
    expect(span.parentSpanContext?.spanId).toBe(PARENT_ID);
    const serialized = span.spanContext().traceState?.serialize() ?? '';
    expect(serialized.split(',').filter(Boolean).length).toBeLessThanOrEqual(32);
  });

  it.each([
    ['a number', 7],
    ['an array', ['a=b']],
    ['malformed', '=,=,'],
  ])('does not break the trace when %s', async (_label, value) => {
    const { span } = await callWithMeta({ [TRACEPARENT_META_KEY]: VALID, [TRACESTATE_META_KEY]: value });
    expect(span.spanContext().traceId).toBe(TRACE_ID);
    expect(span.parentSpanContext?.spanId).toBe(PARENT_ID);
  });
});

describe('baggage', () => {
  it('is available to the tool handler when valid', async () => {
    const { observed } = await callWithMeta({ [TRACEPARENT_META_KEY]: VALID, [BAGGAGE_META_KEY]: 'userId=alice,tenant=acme' });
    expect(observed.baggageEntries).toEqual({ userId: 'alice', tenant: 'acme' });
  });

  it('is available even without a traceparent', async () => {
    const { observed, span } = await callWithMeta({ [BAGGAGE_META_KEY]: 'userId=alice' });
    expect(observed.baggageEntries).toEqual({ userId: 'alice' });
    expect(span.parentSpanContext).toBeUndefined();
  });

  it.each([
    ['a number', 1],
    ['an array', ['a=b']],
    ['malformed', ',,=,'],
  ])('does not break the call when %s', async (_label, value) => {
    const { observed } = await callWithMeta({ [TRACEPARENT_META_KEY]: VALID, [BAGGAGE_META_KEY]: value });
    expect(observed.baggageEntries).toEqual({});
  });
});
