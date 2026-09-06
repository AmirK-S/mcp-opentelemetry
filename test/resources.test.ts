/** resources/read: the uri is an attribute, and only optionally part of the span name. */
import { afterEach, describe, expect, it } from 'vitest';
import { instrumentClientTransport, instrumentServerTransport } from '../src/index.js';
import { ATTR_MCP_RESOURCE_URI } from '../src/semconv.js';
import { connectedPair, setupOtel, type Pair } from './helpers.js';

let pair: Pair | undefined;
afterEach(async () => {
  await pair?.close();
  pair = undefined;
});

describe('resources/read', () => {
  it('names the span resources/read and records the uri as an attribute by default', async () => {
    const otel = setupOtel();
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, otel.options),
      instrumentServer: (t) => instrumentServerTransport(t, otel.options),
    });
    await pair.client.readResource({ uri: 'test://static/readme' });
    for (const span of [otel.clientSpans().at(-1)!, otel.serverSpans().at(-1)!]) {
      expect(span.name).toBe('resources/read');
      expect(span.attributes[ATTR_MCP_RESOURCE_URI]).toBe('test://static/readme');
    }
  });

  it('puts the uri in the span name only when resourceUriInSpanName is set', async () => {
    const otel = setupOtel({ resourceUriInSpanName: true });
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, otel.options),
      instrumentServer: (t) => instrumentServerTransport(t, otel.options),
    });
    await pair.client.readResource({ uri: 'test://static/readme' });
    for (const span of [otel.clientSpans().at(-1)!, otel.serverSpans().at(-1)!]) {
      expect(span.name).toBe('resources/read test://static/readme');
    }
  });
});
