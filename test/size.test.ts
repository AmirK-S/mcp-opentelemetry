/**
 * The size of a maximal `_meta`: the two required envelope keys of
 * 2026-07-28, a valid traceparent, a tracestate at the 512 character
 * minimum every implementation must accept, and a baggage at the 8192 byte
 * limit of W3C Baggage. The number is quoted in the README.
 */
import { describe, expect, it } from 'vitest';
import { BAGGAGE_META_KEY, PROTOCOL_VERSION_META_KEY, TRACEPARENT_META_KEY, TRACESTATE_META_KEY } from '../src/keys.js';

function fill(prefix: string, length: number): string {
  let out = '';
  let i = 0;
  while (out.length < length) out += (out ? ',' : '') + `${prefix}${i++}=${'v'.repeat(20)}`;
  return out.slice(0, length);
}

describe('_meta size', () => {
  it('a maximal _meta serializes to 8909 bytes', () => {
    const meta = {
      [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
      [TRACEPARENT_META_KEY]: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      [TRACESTATE_META_KEY]: fill('k', 512),
      [BAGGAGE_META_KEY]: fill('b', 8192),
    };
    const bytes = Buffer.byteLength(JSON.stringify(meta), 'utf8');
    expect(bytes).toBe(8909);
    expect(bytes).toBeLessThan(100 * 1024 / 11);
  });
});
