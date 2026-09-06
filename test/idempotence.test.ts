/** Applying the package twice must not inject twice nor open two spans. */
import { afterEach, describe, expect, it } from 'vitest';
import { instrumentClient, instrumentClientTransport, instrumentServer, instrumentServerTransport, isInstrumented } from '../src/index.js';
import { TRACEPARENT_META_KEY } from '../src/keys.js';
import { connectedPair, findRequest, metaOf, parseTraceparent, setupOtel, type Pair } from './helpers.js';

let pair: Pair | undefined;
afterEach(async () => {
  await pair?.close();
  pair = undefined;
});

describe('idempotence', () => {
  it('instrumentClientTransport applied twice returns the same object and opens one span per call', async () => {
    const otel = setupOtel();
    pair = await connectedPair({
      instrumentClient: (t) => {
        const once = instrumentClientTransport(t, otel.options);
        const twice = instrumentClientTransport(once, otel.options);
        expect(twice).toBe(once);
        expect(isInstrumented(twice)).toBe(true);
        return twice;
      },
    });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    const spans = otel.clientSpans().filter((s) => s.name === 'tools/call echo');
    expect(spans).toHaveLength(1);
    const tp = parseTraceparent(metaOf(findRequest(pair.wire, 'tools/call'))?.[TRACEPARENT_META_KEY]);
    expect(tp.spanId).toBe(spans[0]!.spanContext().spanId);
  });

  it('instrumentServerTransport applied twice opens one span per request', async () => {
    const otel = setupOtel();
    pair = await connectedPair({
      instrumentServer: (t) => instrumentServerTransport(instrumentServerTransport(t, otel.options), otel.options),
    });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    expect(otel.serverSpans().filter((s) => s.name === 'tools/call echo')).toHaveLength(1);
  });

  it('instrumentClient and instrumentServer applied twice patch connect once', async () => {
    const otel = setupOtel();
    const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client');
    const { McpServer } = await import('@modelcontextprotocol/server');
    const { z } = await import('zod');
    const server = instrumentServer(instrumentServer(new McpServer({ name: 's', version: '0' }), otel.options), otel.options);
    server.registerTool('echo', { inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: 'text', text }] }));
    const client = instrumentClient(instrumentClient(new Client({ name: 'c', version: '0' }), otel.options), otel.options);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    await client.callTool({ name: 'echo', arguments: { text: 'x' } });
    await client.close();
    await server.close();
    expect(otel.clientSpans().filter((s) => s.name === 'tools/call echo')).toHaveLength(1);
    expect(otel.serverSpans().filter((s) => s.name === 'tools/call echo')).toHaveLength(1);
  });

  it('a transport instrumented for one role is not instrumented again for the other', async () => {
    const otel = setupOtel();
    pair = await connectedPair({
      instrumentClient: (t) => instrumentServerTransport(instrumentClientTransport(t, otel.options), otel.options),
    });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    expect(otel.clientSpans().filter((s) => s.name === 'tools/call echo')).toHaveLength(1);
    expect(otel.serverSpans()).toHaveLength(0);
  });
});

describe('role independence', () => {
  it('produces the same spans with the two instrument functions swapped', async () => {
    const otel = setupOtel();
    pair = await connectedPair({
      instrumentClient: (t) => instrumentServerTransport(t, otel.options),
      instrumentServer: (t) => instrumentClientTransport(t, otel.options),
    });
    await pair.client.callTool({ name: 'ask', arguments: { question: 'q' } });
    await new Promise((r) => setImmediate(r));
    const names = otel.spans().map((s) => `${s.kind}:${s.name}`).sort();
    expect(names).toContain('2:tools/call ask');
    expect(names).toContain('1:tools/call ask');
    expect(names).toContain('2:sampling/createMessage');
    expect(names).toContain('1:sampling/createMessage');
  });
});
