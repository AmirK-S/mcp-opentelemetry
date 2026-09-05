/**
 * Reserved `_meta` keys of protocol revision 2026-07-28 (SEP-414).
 * They are reserved without the DNS prefix, as an explicit exception to the
 * `_meta` naming rule. Checked against `@modelcontextprotocol/core/internal`
 * by `test/keys.test.ts`.
 *
 * Reference: https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta
 */
export const TRACEPARENT_META_KEY = 'traceparent';
export const TRACESTATE_META_KEY = 'tracestate';
export const BAGGAGE_META_KEY = 'baggage';

/** Envelope key added by the SDK on every request in the 2026-07-28 era. */
export const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
