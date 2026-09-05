/**
 * An MCP server over stdio, instrumented with mcp-opentelemetry.
 * Run it through the client: `npx tsx examples/stdio/client.ts`.
 */
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { instrumentServerTransport } from '../../src/index.js';
import { startTelemetry } from '../telemetry.js';

const telemetry = startTelemetry('mcp-example-server');
const tracer = telemetry.provider.getTracer('example-server');

const forecasts: Record<string, string> = { paris: 'sunny, 24 C', london: 'rain, 16 C', berlin: 'clouds, 19 C' };

serveStdio(
  () => {
    const server = new McpServer({ name: 'weather', version: '0.1.0' });
    server.registerTool(
      'get-weather',
      { description: 'Current weather for a city', inputSchema: { city: z.string() } },
      async ({ city }): Promise<CallToolResult> => {
        // A child span, parented under the server span opened by the instrumentation.
        return tracer.startActiveSpan('lookup-forecast', async (span): Promise<CallToolResult> => {
          try {
            await new Promise((r) => setTimeout(r, 20));
            const forecast = forecasts[city.toLowerCase()];
            if (forecast === undefined) return { content: [{ type: 'text', text: `no forecast for ${city}` }], isError: true };
            return { content: [{ type: 'text', text: `${city}: ${forecast}` }] };
          } finally {
            span.end();
          }
        });
      },
    );
    return server;
  },
  {
    transport: instrumentServerTransport(new StdioServerTransport(), { tracerProvider: telemetry.provider }),
    onerror: (error) => process.stderr.write(`server error: ${error.message}\n`),
  },
);

const flush = async () => {
  await telemetry.shutdown();
  process.exit(0);
};
process.stdin.on('end', () => void flush());
process.on('SIGTERM', () => void flush());
