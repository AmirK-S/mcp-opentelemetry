# What breaks next, and what to do

Written on 05/09/2026 for version 0.1.0. This package sits between two moving targets: the MCP TypeScript SDK v2, in its first release line, and the OpenTelemetry semantic conventions for MCP, at status Development. Four things can break it. Each has a signal to watch and a response.

## 1. The convention renames or drops attributes

The `mcp.*` and `gen_ai.*` attribute names are marked deprecated in `@opentelemetry/semantic-conventions` since 1.42.0, because they moved to the GenAI repository, from which no package is generated yet. The names this package emits are frozen in `src/semconv.ts` and compared to 1.43.0 by `test/semconv.test.ts`.

Signals: the first release of `open-telemetry/semantic-conventions-genai`; issue `open-telemetry/opentelemetry-js#6783` (a `@opentelemetry/semantic-conventions-genai` package); issue `open-telemetry/semantic-conventions-genai#437` (alignment with `2026-07-28`).

Response: update `src/semconv.ts`, bump the pinned version in `test/semconv.test.ts`, release a minor version with the renames listed in the CHANGELOG. Consumers who query by attribute name update their dashboards.

## 2. `mcp.session.id` and the session model

The convention still describes `mcp.session.id` and an `initialize` span from the `2025-06-18` protocol. Revision `2026-07-28` removed protocol sessions and the handshake. This package does not emit `mcp.session.id` and names the legacy `initialize` request like any other request. If the convention adopts a different identifier for a connection, it will be added; nothing needs removing.

## 3. The next protocol revision changes `_meta`

The keys `traceparent`, `tracestate` and `baggage` are reserved by name in `2026-07-28`. A later revision could move them, prefix them, or add a size bound. The keys are defined once in `src/keys.ts` and checked against `@modelcontextprotocol/core/internal` by `test/keys.test.ts`.

Signals: the `docs/specification/draft/basic/index.mdx` section on `_meta` in the specification repository; SEP-2448 (server execution telemetry in `_meta.otel`, still a draft), which would add a much larger payload to responses.

Response: a major version if the keys move, since older servers and clients would stop seeing each other's context. Support both key sets during a transition.

## 4. The SDK ships its own instrumentation

The Python SDK made OpenTelemetry a default middleware in `mcp` 2.1.1. The TypeScript SDK has an open issue for it (`modelcontextprotocol/typescript-sdk#1264`) with no code, and no server-side middleware point yet (`#1238`). If the SDK ships spans and propagation, this package becomes a complement for what the SDK does not do, today notifications and metrics, or is retired.

Response: detect the SDK instrumentation on the transport, step aside for what it covers, keep the rest. Say so in the README of the release that does it.

## What does not break

- A new 2.x release of the SDK: the package depends only on the shape of the transport interface (`send`, `onmessage`, `onclose`, `start`, `close`) and on `_meta` being passed through, which the SDK tests since PR #2270.
- A new `@opentelemetry/api` 1.x: only the stable API is used.
- A different propagator or tracer provider: both are options.
