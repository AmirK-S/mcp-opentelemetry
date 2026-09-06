/**
 * An instrumented MCP client pointed at a server this package did not ship:
 * HiveMind, a Python server on `fastmcp` 2.x over `mcp` 1.26, exposing
 * Streamable HTTP at http://localhost:8000/mcp/mcp.
 *
 * The point of the example is the asymmetry. This side is instrumented, the
 * other side is not: the client spans are complete and the `traceparent` goes
 * out on the wire in `params._meta`, and nothing on the server picks it up.
 * The trace in Jaeger has exactly the spans this process produced.
 *
 *   docker run --rm --name jaeger -p 16686:16686 -p 4317:4317 -p 4318:4318 \
 *     cr.jaegertracing.io/jaegertracing/jaeger:2.20.0
 *   npx tsx examples/hivemind/client.ts [url]
 *
 * MCP_OTEL_STDERR_SPANS=1 also dumps every finished span as JSON on stderr.
 */
import { context, trace } from '@opentelemetry/api';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { instrumentClientTransport } from '../../src/index.js';
import { startTelemetry } from '../telemetry.js';

const url = new URL(process.argv[2] ?? 'http://localhost:8000/mcp/mcp');

const telemetry = startTelemetry('mcp-example-hivemind-client');
const tracer = telemetry.provider.getTracer('example-hivemind-client');

// HiveMind reads its auth context from the HTTP Authorization header, never
// from tool arguments. HIVEMIND_TOKEN carries the bearer token when there is one.
const token = process.env['HIVEMIND_TOKEN'];
const transport = new StreamableHTTPClientTransport(
  url,
  token === undefined ? {} : { requestInit: { headers: { authorization: `Bearer ${token}` } } },
);

// Read the outbound frames as they are handed to the transport, after the
// instrumentation has injected into `params._meta`. This is the proof that the
// context leaves this process; whether the peer reads it is the peer's affair.
const sent: unknown[] = [];
const send = transport.send.bind(transport);
transport.send = async (message: Parameters<typeof send>[0], options?: Parameters<typeof send>[1]) => {
  sent.push(message);
  return send(message, options);
};

const instrumented = instrumentClientTransport(transport, {
  tracerProvider: telemetry.provider,
  networkTransport: 'tcp',
  serverAddress: url.hostname,
  serverPort: Number(url.port),
});

// HiveMind speaks the 2025 revision: `mcp` 1.26 has no `server/discover`, so a
// pin to 2026-07-28 would fail loudly and `auto` would probe and then fall back.
// `legacy` is the honest setting here, and it costs nothing: `_meta` on requests
// is a 2025 feature too, so the injection works either way.
const client = new Client({ name: 'mcp-otel-hivemind-client', version: '0.1.0' }, { versionNegotiation: { mode: 'legacy' } });

const agent = tracer.startSpan('agent');
const traceId = agent.spanContext().traceId;

try {
  await client.connect(instrumented);
  await context.with(trace.setSpan(context.active(), agent), async () => {
    const tools = await client.listTools();
    console.log(`tools: ${tools.tools.map((t) => t.name).join(', ')}`);

    // A read, and the least intrusive one on offer: no write, no publication.
    const result = await client.callTool({ name: 'search_knowledge', arguments: { query: 'opentelemetry', limit: 1 } });
    console.log(`search_knowledge isError=${String(result.isError ?? false)} ${JSON.stringify(result.content).slice(0, 200)}`);
  });
} catch (error) {
  console.error(`client error: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  agent.end();
  await client.close().catch(() => undefined);
  await telemetry.shutdown();
}

for (const message of sent) {
  const frame = message as { method?: string; params?: { _meta?: Record<string, unknown> } };
  if (frame.method !== undefined) {
    console.log(`sent ${frame.method} _meta=${JSON.stringify(frame.params?._meta ?? null)}`);
  }
}
console.log(`trace ${traceId}`);
console.log(`http://localhost:16686/trace/${traceId}`);
