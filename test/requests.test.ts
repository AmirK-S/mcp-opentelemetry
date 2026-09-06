/**
 * One test per protocol message of the minimal scope: request, result,
 * JSON-RPC error, tools/list. Transport in memory, exporter in memory, no socket.
 */
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it } from 'vitest';
import { instrumentClient, instrumentClientTransport, instrumentServer, instrumentServerTransport } from '../src/index.js';
import {
  ATTR_ERROR_TYPE,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_TOOL_CALL_ARGUMENTS,
  ATTR_GEN_AI_TOOL_CALL_RESULT,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_JSONRPC_PROTOCOL_VERSION,
  ATTR_JSONRPC_REQUEST_ID,
  ATTR_MCP_METHOD_NAME,
  ATTR_MCP_PROTOCOL_VERSION,
  ATTR_RPC_RESPONSE_STATUS_CODE,
  ERROR_TYPE_VALUE_TOOL_ERROR,
  GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
} from '../src/semconv.js';
import { TRACEPARENT_META_KEY } from '../src/keys.js';
import { connectedPair, findRequest, metaOf, parseTraceparent, setupOtel, type Pair } from './helpers.js';

let pair: Pair | undefined;
afterEach(async () => {
  await pair?.close();
  pair = undefined;
});

describe('tools/call request', () => {
  it('carries a traceparent from the client span to the server handler, without touching other _meta keys', async () => {
    const otel = setupOtel();
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, otel.options),
      instrumentServer: (t) => instrumentServerTransport(t, otel.options),
    });
    const agent = otel.startSpan('agent');
    await context.with(trace.setSpan(context.active(), agent), () =>
      pair!.client.callTool({ name: 'echo', arguments: { text: 'hi' }, _meta: { 'example.com/custom': 'kept' } }),
    );
    agent.end();

    const request = findRequest(pair.wire, 'tools/call');
    const meta = metaOf(request);
    expect(meta?.['example.com/custom']).toBe('kept');
    const tp = parseTraceparent(meta?.[TRACEPARENT_META_KEY]);
    expect(tp.traceId).toBe(agent.spanContext().traceId);

    const clientSpan = otel.clientSpans().find((s) => s.name === 'tools/call echo');
    expect(clientSpan).toBeDefined();
    expect(tp.spanId).toBe(clientSpan!.spanContext().spanId);

    // The handler sees the same trace, re-parented under the server span so
    // that anything it forwards hangs below the server span (see README).
    const serverSpan = otel.serverSpans().find((s) => s.name === 'tools/call echo')!;
    const seen = parseTraceparent(pair.observed[0]?.meta?.[TRACEPARENT_META_KEY]);
    expect(seen.traceId).toBe(tp.traceId);
    expect(seen.spanId).toBe(serverSpan.spanContext().spanId);
    expect(pair.observed[0]?.meta?.['example.com/custom']).toBe('kept');
  });

  it('produces one CLIENT span and one SERVER span in the same trace, server parented to client', async () => {
    const otel = setupOtel();
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, otel.options),
      instrumentServer: (t) => instrumentServerTransport(t, otel.options),
    });
    const agent = otel.startSpan('agent');
    await context.with(trace.setSpan(context.active(), agent), () => pair!.client.callTool({ name: 'echo', arguments: { text: 'hi' } }));
    agent.end();

    const clientSpans = otel.clientSpans().filter((s) => s.name === 'tools/call echo');
    const serverSpans = otel.serverSpans().filter((s) => s.name === 'tools/call echo');
    expect(clientSpans).toHaveLength(1);
    expect(serverSpans).toHaveLength(1);
    const [c] = clientSpans;
    const [s] = serverSpans;
    expect(c!.spanContext().traceId).toBe(agent.spanContext().traceId);
    expect(s!.spanContext().traceId).toBe(agent.spanContext().traceId);
    expect(c!.parentSpanContext?.spanId).toBe(agent.spanContext().spanId);
    expect(s!.parentSpanContext?.spanId).toBe(c!.spanContext().spanId);
    expect(s!.links).toHaveLength(0);
  });

  it('sets the required and conditionally required attributes on both spans', async () => {
    const otel = setupOtel();
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, otel.options),
      instrumentServer: (t) => instrumentServerTransport(t, otel.options),
    });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    const request = findRequest(pair.wire, 'tools/call')!;
    const negotiated = pair.negotiatedProtocolVersion();
    expect(negotiated).toBeDefined();

    for (const span of [otel.clientSpans().at(-1)!, otel.serverSpans().at(-1)!]) {
      expect(span.name).toBe('tools/call echo');
      expect(span.attributes[ATTR_MCP_METHOD_NAME]).toBe('tools/call');
      expect(span.attributes[ATTR_GEN_AI_TOOL_NAME]).toBe('echo');
      expect(span.attributes[ATTR_GEN_AI_OPERATION_NAME]).toBe(GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL);
      expect(span.attributes[ATTR_JSONRPC_REQUEST_ID]).toBe(String((request as { id: unknown }).id));
      expect(span.attributes[ATTR_JSONRPC_PROTOCOL_VERSION]).toBeUndefined();
      expect(span.attributes[ATTR_MCP_PROTOCOL_VERSION]).toBe(negotiated);
      expect(span.attributes[ATTR_ERROR_TYPE]).toBeUndefined();
      expect(span.attributes[ATTR_RPC_RESPONSE_STATUS_CODE]).toBeUndefined();
      expect(span.attributes[ATTR_GEN_AI_TOOL_CALL_ARGUMENTS]).toBeUndefined();
      expect(span.attributes[ATTR_GEN_AI_TOOL_CALL_RESULT]).toBeUndefined();
      expect(span.status.code).toBe(SpanStatusCode.UNSET);
      expect(span.instrumentationScope.name).toBe('mcp-opentelemetry');
    }
  });

  it('records arguments and results only when opted in', async () => {
    const otel = setupOtel({ captureArguments: true, captureResults: true });
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, otel.options),
      instrumentServer: (t) => instrumentServerTransport(t, otel.options),
    });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    for (const span of [otel.clientSpans().at(-1)!, otel.serverSpans().at(-1)!]) {
      expect(span.attributes[ATTR_GEN_AI_TOOL_CALL_ARGUMENTS]).toBe(JSON.stringify({ text: 'hi' }));
      expect(JSON.parse(String(span.attributes[ATTR_GEN_AI_TOOL_CALL_RESULT]))).toMatchObject({
        content: [{ type: 'text', text: 'echo: hi' }],
      });
    }
  });

  it('runs the tool handler inside the server span context', async () => {
    const otel = setupOtel();
    pair = await connectedPair(
      {
        instrumentClient: (t) => instrumentClientTransport(t, otel.options),
        instrumentServer: (t) => instrumentServerTransport(t, otel.options),
      },
      otel,
    );
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    const serverSpan = otel.serverSpans().find((s) => s.name === 'tools/call echo')!;
    const obs = pair.observed[0]!;
    expect(obs.activeSpan?.spanContext().spanId).toBe(serverSpan.spanContext().spanId);
    const child = otel.spans().find((s) => s.name === 'inside-tool')!;
    expect(child.parentSpanContext?.spanId).toBe(serverSpan.spanContext().spanId);
    // The server span ends after the handler, not before.
    expect(serverSpan.endTime[0] * 1e9 + serverSpan.endTime[1]).toBeGreaterThanOrEqual(child.endTime[0] * 1e9 + child.endTime[1]);
  });
});

describe('tools/call result with isError', () => {
  it('sets error.type=tool_error and status ERROR on both spans', async () => {
    const otel = setupOtel();
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, otel.options),
      instrumentServer: (t) => instrumentServerTransport(t, otel.options),
    });
    const result = await pair.client.callTool({ name: 'fail', arguments: {} });
    expect(result.isError).toBe(true);
    for (const span of [otel.clientSpans().at(-1)!, otel.serverSpans().at(-1)!]) {
      expect(span.name).toBe('tools/call fail');
      expect(span.attributes[ATTR_ERROR_TYPE]).toBe(ERROR_TYPE_VALUE_TOOL_ERROR);
      expect(span.attributes[ATTR_RPC_RESPONSE_STATUS_CODE]).toBeUndefined();
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
    }
  });
});

describe('JSON-RPC error response', () => {
  it('sets error.type and rpc.response.status_code to the error code on both spans', async () => {
    const otel = setupOtel();
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, otel.options),
      instrumentServer: (t) => instrumentServerTransport(t, otel.options),
    });
    let code: number | undefined;
    try {
      await pair.client.callTool({ name: 'does-not-exist', arguments: {} });
    } catch (error) {
      code = (error as { code?: number }).code;
    }
    expect(typeof code).toBe('number');
    const errorResponse = pair.wire.serverToClient.find((m) => 'error' in m);
    expect(errorResponse).toBeDefined();
    for (const span of [otel.clientSpans().at(-1)!, otel.serverSpans().at(-1)!]) {
      expect(span.name).toBe('tools/call does-not-exist');
      expect(span.attributes[ATTR_ERROR_TYPE]).toBe(String(code));
      expect(span.attributes[ATTR_RPC_RESPONSE_STATUS_CODE]).toBe(String(code));
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
    }
  });
});

describe('tools/list request', () => {
  it('produces spans named tools/list without tool attributes', async () => {
    const otel = setupOtel();
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, otel.options),
      instrumentServer: (t) => instrumentServerTransport(t, otel.options),
    });
    await pair.client.listTools();
    const c = otel.clientSpans().find((s) => s.name === 'tools/list');
    const s = otel.serverSpans().find((s) => s.name === 'tools/list');
    expect(c).toBeDefined();
    expect(s).toBeDefined();
    expect(s!.parentSpanContext?.spanId).toBe(c!.spanContext().spanId);
    for (const span of [c!, s!]) {
      expect(span.attributes[ATTR_MCP_METHOD_NAME]).toBe('tools/list');
      expect(span.attributes[ATTR_GEN_AI_TOOL_NAME]).toBeUndefined();
      expect(span.attributes[ATTR_GEN_AI_OPERATION_NAME]).toBeUndefined();
    }
  });
});

describe('parenting rule', () => {
  it('makes the ambient server context a link, not a parent, when _meta carries a valid traceparent', async () => {
    const otel = setupOtel();
    const ambient = otel.startSpan('incoming-http');
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, otel.options),
      instrumentServer: (t) => instrumentServerTransport(t, otel.options),
      serverAmbient: () => trace.setSpan(context.active(), ambient),
    });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    ambient.end();
    const c = otel.clientSpans().find((s) => s.name === 'tools/call echo')!;
    const s = otel.serverSpans().find((s) => s.name === 'tools/call echo')!;
    expect(s.parentSpanContext?.spanId).toBe(c.spanContext().spanId);
    expect(s.links.map((l) => l.context.spanId)).toEqual([ambient.spanContext().spanId]);
  });

  it('uses the ambient server context as parent when the request carries no traceparent', async () => {
    const otel = setupOtel();
    const ambient = otel.startSpan('incoming-http');
    pair = await connectedPair({
      instrumentServer: (t) => instrumentServerTransport(t, otel.options),
      serverAmbient: () => trace.setSpan(context.active(), ambient),
    });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    ambient.end();
    const s = otel.serverSpans().find((s) => s.name === 'tools/call echo')!;
    expect(s.spanContext().traceId).toBe(ambient.spanContext().traceId);
    expect(s.parentSpanContext?.spanId).toBe(ambient.spanContext().spanId);
    expect(s.links).toHaveLength(0);
  });

  it('starts a new trace on the server when nothing is propagated and nothing is ambient', async () => {
    const otel = setupOtel();
    pair = await connectedPair({ instrumentServer: (t) => instrumentServerTransport(t, otel.options) });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    const s = otel.serverSpans().find((s) => s.name === 'tools/call echo')!;
    expect(s.parentSpanContext).toBeUndefined();
    expect(otel.clientSpans()).toHaveLength(0);
  });
});

describe('instrumentClient and instrumentServer', () => {
  it('instrument whatever transport connect() receives', async () => {
    const otel = setupOtel();
    pair = await connectedPair();
    // Re-create a pair whose objects are patched before connect.
    await pair.close();
    const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client');
    const { McpServer } = await import('@modelcontextprotocol/server');
    const { z } = await import('zod');
    const server = instrumentServer(new McpServer({ name: 's', version: '0' }), otel.options);
    server.registerTool('echo', { inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: 'text', text }] }));
    const client = instrumentClient(new Client({ name: 'c', version: '0' }), otel.options);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    await client.callTool({ name: 'echo', arguments: { text: 'x' } });
    await client.close();
    await server.close();
    const c = otel.clientSpans().find((s) => s.name === 'tools/call echo');
    const s = otel.serverSpans().find((s) => s.name === 'tools/call echo');
    expect(c).toBeDefined();
    expect(s).toBeDefined();
    expect(s!.parentSpanContext?.spanId).toBe(c!.spanContext().spanId);
  });
});

describe('transport lifecycle', () => {
  it('ends a pending client span with an error when the transport closes mid-flight', async () => {
    const otel = setupOtel();
    pair = await connectedPair({ instrumentClient: (t) => instrumentClientTransport(t, otel.options), slowMs: 500 });
    const call = pair.client.callTool({ name: 'slow', arguments: {} }).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 20));
    await pair.clientTransport.close();
    await call;
    const c = otel.clientSpans().find((s) => s.name === 'tools/call slow');
    expect(c).toBeDefined();
    expect(c!.status.code).toBe(SpanStatusCode.ERROR);
    expect(c!.attributes[ATTR_ERROR_TYPE]).toBeDefined();
  });
});
