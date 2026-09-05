/**
 * Two real processes over stdio: the example client in this process, the
 * example server spawned as a child. The server exports its spans as JSON
 * lines on stderr; the client keeps its spans in memory. No network.
 */
import { context, SpanKind, trace } from '@opentelemetry/api';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, describe, expect, it } from 'vitest';
import { instrumentClientTransport } from '../../src/index.js';
import { ATTR_GEN_AI_TOOL_NAME, ATTR_MCP_METHOD_NAME, ATTR_MCP_PROTOCOL_VERSION, ATTR_NETWORK_TRANSPORT } from '../../src/semconv.js';
import { setupOtel } from '../helpers.js';

interface ExportedSpan {
  name: string;
  kind: number;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  attributes: Record<string, unknown>;
  status: { code: number };
  service: string;
}

const root = new URL('../../', import.meta.url).pathname;
const serverSpans: ExportedSpan[] = [];
let stderrText = '';

describe('client and server over stdio', () => {
  const otel = setupOtel();
  let traceId = '';
  let clientSpanId = '';

  afterAll(() => {
    // Keep the raw server output for the record.
    void stderrText;
  });

  it('produces one trace across both processes', async () => {
    const transport = instrumentClientTransport(
      new StdioClientTransport({
        command: process.execPath,
        args: [`${root}node_modules/tsx/dist/cli.mjs`, `${root}examples/stdio/server.ts`],
        env: { ...process.env, MCP_OTEL_STDERR_SPANS: '1', MCP_OTEL_NO_OTLP: '1' } as Record<string, string>,
        stderr: 'pipe',
        cwd: root,
      }),
      otel.options,
    );
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderrText += chunk.toString();
    });
    const client = new Client({ name: 'integration-client', version: '0.0.0' });
    await client.connect(transport);

    const agent = otel.startSpan('agent');
    traceId = agent.spanContext().traceId;
    const result = await context.with(trace.setSpan(context.active(), agent), () =>
      client.callTool({ name: 'get-weather', arguments: { city: 'Paris' } }),
    );
    agent.end();
    expect(result.content).toEqual([{ type: 'text', text: 'Paris: sunny, 24 C' }]);

    await client.close();
    // Give the child a moment to flush its stderr after stdin ends.
    await new Promise((r) => setTimeout(r, 500));

    for (const line of stderrText.split('\n')) {
      if (line.startsWith('{')) serverSpans.push(JSON.parse(line) as ExportedSpan);
    }

    const clientSpan = otel.clientSpans().find((s) => s.name === 'tools/call get-weather');
    expect(clientSpan).toBeDefined();
    clientSpanId = clientSpan!.spanContext().spanId;
    expect(clientSpan!.spanContext().traceId).toBe(traceId);
    expect(clientSpan!.attributes[ATTR_NETWORK_TRANSPORT]).toBe('pipe');

    const serverSpan = serverSpans.find((s) => s.name === 'tools/call get-weather' && s.kind === SpanKind.SERVER);
    expect(serverSpan, `server spans seen: ${serverSpans.map((s) => s.name).join(', ')}`).toBeDefined();
    expect(serverSpan!.traceId).toBe(traceId);
    expect(serverSpan!.parentSpanId).toBe(clientSpanId);
    expect(serverSpan!.service).toBe('mcp-example-server');
    expect(serverSpan!.attributes[ATTR_MCP_METHOD_NAME]).toBe('tools/call');
    expect(serverSpan!.attributes[ATTR_GEN_AI_TOOL_NAME]).toBe('get-weather');
    expect(serverSpan!.attributes[ATTR_NETWORK_TRANSPORT]).toBe('pipe');
    expect(typeof serverSpan!.attributes[ATTR_MCP_PROTOCOL_VERSION]).toBe('string');
    expect(clientSpan!.attributes[ATTR_MCP_PROTOCOL_VERSION]).toBe(serverSpan!.attributes[ATTR_MCP_PROTOCOL_VERSION]);

    const lookup = serverSpans.find((s) => s.name === 'lookup-forecast');
    expect(lookup).toBeDefined();
    expect(lookup!.traceId).toBe(traceId);
    expect(lookup!.parentSpanId).toBe(serverSpan!.spanId);
  });
});
