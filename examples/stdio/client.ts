/**
 * An MCP client that spawns the stdio server and calls a tool inside an
 * `agent` span. Prints the trace id and the Jaeger link.
 *
 *   docker run --rm --name jaeger -p 16686:16686 -p 4317:4317 -p 4318:4318 cr.jaegertracing.io/jaegertracing/jaeger:2.20.0
 *   npx tsx examples/stdio/client.ts
 */
import { context, trace } from '@opentelemetry/api';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { instrumentClientTransport } from '../../src/index.js';
import { startTelemetry } from '../telemetry.js';

const telemetry = startTelemetry('mcp-example-client');
const tracer = telemetry.provider.getTracer('example-client');

const transport = instrumentClientTransport(
  new StdioClientTransport({
    command: process.execPath,
    args: [new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url).pathname, new URL('./server.ts', import.meta.url).pathname],
    env: { ...process.env, MCP_OTEL_STDERR_SPANS: process.env['MCP_OTEL_STDERR_SPANS'] ?? '0' } as Record<string, string>,
  }),
  { tracerProvider: telemetry.provider },
);

const client = new Client({ name: 'example-agent', version: '0.1.0' });
await client.connect(transport);

const agent = tracer.startSpan('agent');
const traceId = agent.spanContext().traceId;
await context.with(trace.setSpan(context.active(), agent), async () => {
  const city = process.argv[2] ?? 'Paris';
  const result = await client.callTool({ name: 'get-weather', arguments: { city } });
  console.log(JSON.stringify(result.content));
});
agent.end();

await client.close();
await telemetry.shutdown();
console.log(`trace ${traceId}`);
console.log(`http://localhost:16686/trace/${traceId}`);
