/**
 * A minimal MCP client over Streamable HTTP whose transport is instrumented by
 * mcp-opentelemetry. Used as the client under test for the conformance suite's
 * `request-metadata` scenario (SEP-2575), which asserts that every POST carries
 * the `MCP-Protocol-Version` header and that `params._meta` carries
 * `io.modelcontextprotocol/protocolVersion` and
 * `io.modelcontextprotocol/clientCapabilities`.
 *
 * The instrumentation writes `traceparent` into the same `params._meta` object,
 * so this run is the proof that the injection is additive: it adds keys, it
 * never rewrites or drops the SEP-2575 envelope the SDK put there.
 *
 * The suite appends the scenario server URL as the last argument and sets
 * MCP_CONFORMANCE_SCENARIO in the environment:
 *
 *   npx -y @modelcontextprotocol/conformance@0.2.0-alpha.11 client \
 *     --command "npx tsx examples/http/client.ts" --scenario request-metadata
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { instrumentClientTransport } from '../../src/index.js';
import { startTelemetry } from '../telemetry.js';

const url = process.argv[process.argv.length - 1];
if (url === undefined || !url.startsWith('http')) {
  process.stderr.write('usage: tsx examples/http/client.ts <server-url>\n');
  process.exit(2);
}

// No OTLP collector in a conformance run; spans go to stderr when asked for.
process.env['MCP_OTEL_NO_OTLP'] = process.env['MCP_OTEL_NO_OTLP'] ?? '1';
const telemetry = startTelemetry('mcp-example-http-client');

const transport = instrumentClientTransport(new StreamableHTTPClientTransport(new URL(url)), {
  tracerProvider: telemetry.provider,
  networkTransport: 'tcp',
});

// The suite forwards the revision under test as MCP_CONFORMANCE_PROTOCOL_VERSION.
// Without an explicit pin the SDK client defaults to `versionNegotiation: 'legacy'`
// and runs the 2025 initialize handshake, which carries no per-request `_meta`
// envelope at all: every SEP-2575 check then fails for want of a modern wire.
const protocolVersion = process.env['MCP_CONFORMANCE_PROTOCOL_VERSION'] ?? '2026-07-28';

const client = new Client(
  { name: 'mcp-otel-conformance-client', version: '0.1.0' },
  {
    capabilities: { roots: { listChanged: true }, sampling: {}, elicitation: {} },
    versionNegotiation: { mode: { pin: protocolVersion } },
  },
);

try {
  await client.connect(transport);
  // Two more POSTs, so the scenario sees the envelope on ordinary requests and
  // not only on the negotiation probe.
  await client.listTools();
  await client.callTool({ name: 'test_simple_text', arguments: {} }).catch(() => undefined);
} catch (error) {
  process.stderr.write(`client error: ${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  await client.close().catch(() => undefined);
  await telemetry.shutdown();
}
