# Closing state

Written on 2026-09-06, after the publication of 0.2.0. This file says what "done" means for this package and what would reopen it.

## Versions

- Published: `mcp-opentelemetry` 0.1.0 and 0.2.0 on npm, tags `v0.1.0` and `v0.2.0`, releases on GitHub.
- Tested against `@modelcontextprotocol/{client,server,core}` 2.0.0, `@opentelemetry/api` 1.9, Node 20, 22 and 24 (CI), `@opentelemetry/semantic-conventions` 1.43.0 (attribute names, checked by `test/semconv.test.ts`), `@modelcontextprotocol/conformance` 0.2.0-alpha.11 (`npm run conformance`).
- Every dependency is pinned in `package-lock.json`.

## What is covered

Requests in both directions, notifications, the four duration histograms, the parenting rule of the convention, W3C format fallbacks, idempotence, coexistence with a propagation-only wrapper; a two-process stdio test, a Jaeger end-to-end test, the official conformance suite bare against instrumented, and one real run against a server on the Python SDK (`docs/USAGE-REEL.md`).

## What is not, and will not be unless asked

- `client.address` and `client.port` on the server side.
- A measured overhead figure per request.
- A CommonJS build.
- HTTP entry rejections that never reach the transport (see README, Known limits).
- Spans for the SDK's own retries or resumption.

None of these is a known defect. Each will be considered on an issue that describes a real use.

## Signals that reopen the package

Listed with their responses in [END-OF-LIFE.md](END-OF-LIFE.md): a rename in the MCP semantic conventions, a change to the reserved `_meta` keys in a later protocol revision, the SDK shipping its own instrumentation, a 2.x release of the SDK that changes the transport interface.

## Issues

Issues get an answer within seven days. The answer is not a commitment to ship what is asked. Security reports follow `SECURITY.md`.
