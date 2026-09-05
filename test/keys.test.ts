import { describe, expect, it } from 'vitest';
import * as sdk from '@modelcontextprotocol/core/internal';
import { BAGGAGE_META_KEY, PROTOCOL_VERSION_META_KEY, TRACEPARENT_META_KEY, TRACESTATE_META_KEY } from '../src/keys.js';

describe('reserved _meta keys', () => {
  it('match the constants exported by @modelcontextprotocol/core 2.x', () => {
    expect(TRACEPARENT_META_KEY).toBe(sdk.TRACEPARENT_META_KEY);
    expect(TRACESTATE_META_KEY).toBe(sdk.TRACESTATE_META_KEY);
    expect(BAGGAGE_META_KEY).toBe(sdk.BAGGAGE_META_KEY);
    expect(PROTOCOL_VERSION_META_KEY).toBe(sdk.PROTOCOL_VERSION_META_KEY);
  });
});
