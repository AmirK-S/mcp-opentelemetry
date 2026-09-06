/**
 * Requests the server initiates: sampling/createMessage and elicitation/create.
 * The server side opens a CLIENT span under the active server span, injects
 * into params._meta; the client side opens a SERVER span parented to it and
 * runs the handler inside it.
 */
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it } from 'vitest';
import { instrumentClientTransport, instrumentServerTransport } from '../src/index.js';
import { TRACEPARENT_META_KEY } from '../src/keys.js';
import { ATTR_ERROR_TYPE, ATTR_GEN_AI_TOOL_NAME, ATTR_JSONRPC_REQUEST_ID, ATTR_MCP_METHOD_NAME, ATTR_RPC_RESPONSE_STATUS_CODE } from '../src/semconv.js';
import { connectedPair, metaOf, parseTraceparent, setupOtel, type Pair } from './helpers.js';

let pair: Pair | undefined;
afterEach(async () => {
  await pair?.close();
  pair = undefined;
});

async function run(method: string, tool: string, args: Record<string, unknown>, clientHandlerThrows = false) {
  const otel = setupOtel();
  pair = await connectedPair(
    {
      instrumentClient: (t) => instrumentClientTransport(t, otel.options),
      instrumentServer: (t) => instrumentServerTransport(t, otel.options),
      clientHandlerThrows,
    },
    otel,
  );
  const agent = otel.startSpan('agent');
  const result = await context.with(trace.setSpan(context.active(), agent), () => pair!.client.callTool({ name: tool, arguments: args }));
  agent.end();
  await new Promise((r) => setImmediate(r));
  const toolServerSpan = otel.serverSpans().find((s) => s.name === `tools/call ${tool}`)!;
  const outboundOnServer = otel.clientSpans().find((s) => s.name === method);
  const inboundOnClient = otel.serverSpans().find((s) => s.name === method);
  const wireRequest = pair.wire.serverToClient.find((m) => 'method' in m && m.method === method && 'id' in m);
  return { otel, agent, result, toolServerSpan, outboundOnServer, inboundOnClient, wireRequest };
}

describe('sampling/createMessage initiated by the server', () => {
  it('opens a CLIENT span on the server under the tool span, and a SERVER span on the client under it', async () => {
    const { agent, result, toolServerSpan, outboundOnServer, inboundOnClient } = await run('sampling/createMessage', 'ask', { question: 'why' });
    expect(result.content).toEqual([{ type: 'text', text: 'model said: echo why' }]);
    expect(outboundOnServer).toBeDefined();
    expect(outboundOnServer!.kind).toBe(SpanKind.CLIENT);
    expect(outboundOnServer!.parentSpanContext?.spanId).toBe(toolServerSpan.spanContext().spanId);
    expect(inboundOnClient).toBeDefined();
    expect(inboundOnClient!.kind).toBe(SpanKind.SERVER);
    expect(inboundOnClient!.parentSpanContext?.spanId).toBe(outboundOnServer!.spanContext().spanId);
    for (const s of [outboundOnServer!, inboundOnClient!]) expect(s.spanContext().traceId).toBe(agent.spanContext().traceId);
  });

  it('carries the traceparent of the server-side CLIENT span on the wire', async () => {
    const { outboundOnServer, wireRequest } = await run('sampling/createMessage', 'ask', { question: 'why' });
    const tp = parseTraceparent(metaOf(wireRequest)?.[TRACEPARENT_META_KEY]);
    expect(tp.spanId).toBe(outboundOnServer!.spanContext().spanId);
  });

  it('runs the client handler inside the client-side SERVER span', async () => {
    const { otel, inboundOnClient } = await run('sampling/createMessage', 'ask', { question: 'why' });
    expect(pair!.clientObserved[0]?.activeSpan?.spanContext().spanId).toBe(inboundOnClient!.spanContext().spanId);
    const child = otel.spans().find((s) => s.name === 'inside-client-handler')!;
    expect(child.parentSpanContext?.spanId).toBe(inboundOnClient!.spanContext().spanId);
  });

  it('sets the method and id attributes, and no tool attribute', async () => {
    const { outboundOnServer, inboundOnClient, wireRequest } = await run('sampling/createMessage', 'ask', { question: 'why' });
    for (const s of [outboundOnServer!, inboundOnClient!]) {
      expect(s.attributes[ATTR_MCP_METHOD_NAME]).toBe('sampling/createMessage');
      expect(s.attributes[ATTR_JSONRPC_REQUEST_ID]).toBe(String((wireRequest as { id: unknown }).id));
      expect(s.attributes[ATTR_GEN_AI_TOOL_NAME]).toBeUndefined();
      expect(s.status.code).toBe(SpanStatusCode.UNSET);
    }
  });

  it('marks both spans as errors when the client handler fails', async () => {
    const { outboundOnServer, inboundOnClient } = await run('sampling/createMessage', 'ask', { question: 'why' }, true);
    const errorResponse = pair!.wire.clientToServer.find((m) => 'error' in m) as { error: { code: number } } | undefined;
    expect(errorResponse).toBeDefined();
    for (const s of [outboundOnServer!, inboundOnClient!]) {
      expect(s.status.code).toBe(SpanStatusCode.ERROR);
      expect(s.attributes[ATTR_ERROR_TYPE]).toBe(String(errorResponse!.error.code));
      expect(s.attributes[ATTR_RPC_RESPONSE_STATUS_CODE]).toBe(String(errorResponse!.error.code));
    }
  });
});

describe('elicitation/create initiated by the server', () => {
  it('produces the same pair of spans in the same trace', async () => {
    const { agent, result, toolServerSpan, outboundOnServer, inboundOnClient } = await run('elicitation/create', 'confirm', {});
    expect(result.content).toEqual([{ type: 'text', text: 'user accept' }]);
    expect(outboundOnServer!.parentSpanContext?.spanId).toBe(toolServerSpan.spanContext().spanId);
    expect(inboundOnClient!.parentSpanContext?.spanId).toBe(outboundOnServer!.spanContext().spanId);
    expect(inboundOnClient!.spanContext().traceId).toBe(agent.spanContext().traceId);
  });
});
