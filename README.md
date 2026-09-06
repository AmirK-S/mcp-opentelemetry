# mcp-opentelemetry

[![ci](https://github.com/AmirK-S/mcp-opentelemetry/actions/workflows/ci.yml/badge.svg)](https://github.com/AmirK-S/mcp-opentelemetry/actions/workflows/ci.yml)

OpenTelemetry instrumentation for the MCP TypeScript SDK v2 (`@modelcontextprotocol/client`, `@modelcontextprotocol/server` 2.x), protocol revision `2026-07-28`.

It does two things the SDK leaves to you:

1. **Propagation.** The W3C Trace Context of the caller travels in `params._meta` under the keys `traceparent`, `tracestate` and `baggage`, exactly as the specification reserves them (SEP-414). Injected on the client, extracted on the server.
2. **Spans.** One `CLIENT` span per request on the client, one `SERVER` span per request on the server, named and attributed after the [OpenTelemetry semantic conventions for MCP](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md). The server span is active while your tool runs, so the spans your tool creates hang below it.

The result is a single trace: the agent span, the client span, the server span in the other process, and whatever the tool opens below it, in Jaeger or any OTLP backend.

No fork, no `--require`, no module-level monkey patching: you pass the transport to one function, and the patch points are the few lines of `instrumentTransport` in `src/instrumentation.ts`.

## Status

- Version 0.1.0. Targets `@modelcontextprotocol/*` 2.0.0, the first release line that speaks `2026-07-28`. The 1.x SDK is not supported. Node 20 or later.
- Client-initiated requests only. `tools/call`, `tools/list` and every other request the client sends gets a span. Requests the server initiates (`sampling/createMessage`, `elicitation/create`, `roots/list`) are passed through: no span, no injection. Notifications and metrics are not instrumented yet (see Roadmap).
- The MCP semantic conventions are at status Development and may change. While they are, a minor version of this package may rename attributes; patch versions never change what is emitted. Attribute names live in one module of this package, checked by a test against `@opentelemetry/semantic-conventions` 1.43.0. Read [docs/END-OF-LIFE.md](https://github.com/AmirK-S/mcp-opentelemetry/blob/main/docs/END-OF-LIFE.md) before depending on this in production.

Dependencies are pinned in `package-lock.json`; the tested combinations are:

| mcp-opentelemetry | MCP SDK | `@opentelemetry/api` | Node |
| --- | --- | --- | --- |
| 0.1.x | `@modelcontextprotocol/{client,server,core}` 2.0.x | 1.9 or later | 20, 22, 24 (tested in CI) |

## Install

```sh
npm install mcp-opentelemetry @opentelemetry/api
```

`@opentelemetry/api` is the only peer dependency. The MCP packages are not imported at runtime: the package works on the shape of a transport, so it stays usable across the 2.x line.

You also need a tracer provider and a propagator registered, as with any OpenTelemetry instrumentation. `@opentelemetry/sdk-node` does that for you; `examples/telemetry.ts` shows the minimal manual setup with `@opentelemetry/sdk-trace-node`.

## Quick start

### Server over stdio

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { instrumentServerTransport } from 'mcp-opentelemetry';

serveStdio(() => {
  const server = new McpServer({ name: 'weather', version: '1.0.0' });
  server.registerTool('get-weather', { inputSchema: { city: z.string() } }, async ({ city }) => {
    // trace.getActiveSpan() is the MCP server span here.
    return { content: [{ type: 'text', text: await lookup(city) }] };
  });
  return server;
}, {
  transport: instrumentServerTransport(new StdioServerTransport()),
});
```

### Server over HTTP

`createMcpHandler` builds its transport internally, so instrument the server instance instead: its `connect` is patched and every transport it connects to is instrumented.

```ts
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { instrumentServer } from 'mcp-opentelemetry';

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'weather', version: '1.0.0' });
  // register tools...
  return instrumentServer(server);
});
```

`examples/http/server.ts` is a complete server of this shape, the one the conformance suite runs against.

### Client

```ts
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { instrumentClientTransport } from 'mcp-opentelemetry';

const client = new Client({ name: 'agent', version: '1.0.0' });
await client.connect(instrumentClientTransport(new StdioClientTransport({ command: 'node', args: ['server.js'] })));

// Any span active here becomes the parent of the request span.
await client.callTool({ name: 'get-weather', arguments: { city: 'Paris' } });
```

`instrumentClient(client)` does the same through `connect`, for code that does not own the transport.

### Options

Every function takes an optional second argument:

| Option | Default | Effect |
| --- | --- | --- |
| `tracerProvider` | global provider of `@opentelemetry/api` | where spans come from |
| `propagator` | global propagator of `@opentelemetry/api` | how `_meta` is written and read |
| `captureArguments` | `false` | record `gen_ai.tool.call.arguments` (tool arguments may be sensitive) |
| `captureResults` | `false` | record `gen_ai.tool.call.result` (tool results may be sensitive) |
| `resourceUriInSpanName` | `false` | put the uri in the span name of `resources/read`; the convention marks this opt-in because of cardinality and because a uri can carry a path |
| `networkTransport` | detected from the transport class | value of `network.transport` (`pipe` for stdio, `tcp` for HTTP) |
| `serverAddress`, `serverPort` | unset | values of `server.address` and `server.port` |

Applying the package twice to the same object is a no-op.

### Exports

Besides the five functions above, the package exports `isInstrumented(transport)`, the `_meta` key constants (`TRACEPARENT_META_KEY`, `TRACESTATE_META_KEY`, `BAGGAGE_META_KEY`, `PROTOCOL_VERSION_META_KEY`), the attribute and metric name constants of `src/semconv.ts` (`ATTR_MCP_METHOD_NAME`, `ATTR_GEN_AI_TOOL_NAME`, ...), the `error.type` values (`ERROR_TYPE_VALUE_TOOL_ERROR`, `ERROR_TYPE_VALUE_CONNECTION_CLOSED`), and `PACKAGE_NAME`, `PACKAGE_VERSION`. Use the constants rather than copying the strings: they follow the convention when it moves.

## What you get

### Spans

| Side | Kind | Name | Starts | Ends |
| --- | --- | --- | --- | --- |
| client | `CLIENT` | `{method} {target}` | when the request is handed to the transport | when the matching response arrives, when the write fails, or when the transport closes |
| server | `SERVER` | `{method} {target}` | when the request arrives from the transport | when the response has been written, when the write fails, or when the transport closes |

`target` is the tool name for `tools/call` and the prompt name for `prompts/get`, and absent otherwise: `tools/list` is named `tools/list`, a tool call `tools/call get-weather`, a resource read `resources/read` (the uri is an attribute, and part of the name only with `resourceUriInSpanName`).

### Attributes

| Attribute | When | Value |
| --- | --- | --- |
| `mcp.method.name` | always | `tools/call`, `tools/list`, ... |
| `jsonrpc.request.id` | always | the id, as a string |
| `jsonrpc.protocol.version` | only when it is not `2.0` | as received |
| `mcp.protocol.version` | when known | from `io.modelcontextprotocol/protocolVersion` in `_meta`, or from the `initialize` result on legacy connections |
| `gen_ai.tool.name` | `tools/call` | the tool name |
| `gen_ai.operation.name` | `tools/call` | `execute_tool` |
| `gen_ai.prompt.name` | `prompts/get` | the prompt name |
| `mcp.resource.uri` | `resources/read` | the uri |
| `error.type` | on failure | the JSON-RPC error code as a string; `tool_error` when the result carries `isError`; `connection_closed` when the transport closed first; the error name when the transport rejects the write, or `send_failed` when the rejected value is not an `Error` |
| `rpc.response.status_code` | JSON-RPC error | the error code as a string |
| `network.transport` | when known | `pipe`, `tcp` |
| `server.address`, `server.port` | when given | as given |
| `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` | opt-in | JSON |

The span status is `ERROR` on a JSON-RPC error, on `isError`, and on a failed write or a closed transport; `UNSET` otherwise.

`mcp.session.id` is not recorded: revision `2026-07-28` removed protocol sessions.

### Parenting

- The context carried by `_meta` is the parent of the server span. An ambient context on the server, for instance the span of the incoming HTTP request opened by another instrumentation, becomes a **link**, not a parent, as the convention asks. Transport and MCP contexts are independent.
- When `_meta` carries no context, or an invalid one, the ambient context is the parent, and a new trace starts if there is none. A malformed `traceparent` never fails the call and never orphans the span. Baggage is extracted even without a `traceparent`.
- On the server the package rewrites the inbound `traceparent` so that it names the server span. Anything that extracts `_meta` again downstream, a second instrumentation or a handler forwarding the request, parents under the server span. The trace id does not change. Every other `_meta` key is left untouched.
- The client never drops `_meta` entries: it copies what the SDK and the caller put there, adds its three keys, and leaves the object the caller still holds untouched, so the required `io.modelcontextprotocol/*` keys of `2026-07-28` survive. The conformance scenario `request-metadata` checks exactly that.

### Size

A complete `_meta` with the two required envelope keys, a 512 character `tracestate` and an 8192 byte `baggage` weighs 8909 bytes serialized (`test/size.test.ts` computes it). The lowest bound among the MCP TypeScript middlewares is the 100 KiB default of `express.json()`, which `@modelcontextprotocol/express` 2.0.0 applies unless `jsonLimit` is set; the SDK stdio buffer is 10 MiB. `@opentelemetry/core` already caps `baggage` at 8192 bytes and `tracestate` at 512 characters when injecting, silently; the package logs a debug line through `diag` when entries are dropped.

## Known limits

- Not yet covered: requests the server initiates (`sampling/createMessage`, `elicitation/create`, `roots/list`) get no span and no `traceparent`; planned for 0.2.0.
- HTTP requests rejected before the transport (missing `Mcp-Method` header, a 2025-era opening on a modern-only route, 405) never reach the instrumentation and produce no span. Put an HTTP instrumentation in front if you need them.
- Notifications (`notifications/progress`, `notifications/cancelled`) are passed through unchanged for now.
- Hosts that send no `traceparent` start the trace at the server. Measured on 2026-09-05: Claude Code 2.1.261 speaks `2025-11-25` and puts only `progressToken` and `claudecode/toolUseId` in `_meta`, so a server behind it produces root spans, one per tool call.
- No metrics yet. The four duration metrics of the convention are the next step.
- ESM only. A CommonJS build can be added if someone needs it; the SDK 2.x ships both, so the constraint comes from this package, not from the SDK.
- Instrument a transport before `connect()`. Applied later, the package wraps the callbacks already installed, but the messages that went through before are not seen.

## How it is tested

Everything below runs with `npm test`, offline, transport and exporter in memory:

- one test per protocol message of the scope: request, result, JSON-RPC error, `tools/list`, `resources/read`, with the exact attributes and the parent relations checked span by span;
- twelve malformed `traceparent` values (version `ff`, all-zero ids, wrong lengths, non-strings) with and without an ambient context, plus `tracestate` above 32 entries and malformed `baggage`: the call succeeds, the span is never orphaned;
- idempotence, and coexistence with a propagation-only wrapper in both orders on both sides;
- the internal attribute names and `_meta` keys against the published constants.

Four manual mutations, run once on 2026-09-05 against the suite of 79 tests: disabling extraction makes 16 tests fail, breaking span naming 55, removing injection 8, dropping the context activation around the dispatch 4.

`npm run test:integration` adds two real processes over stdio, then the same through Jaeger with the trace read back from its API. The trace of the last run is in `test/integration/results/jaeger-trace.json`.

The official conformance suite, `@modelcontextprotocol/conformance` 0.2.0-alpha.11 with `--requirements 2026-07-28`, runs against the HTTP example server (`examples/http/server.ts`) with and without instrumentation; `npm run conformance` compares both runs and fails on any difference. Last run, 2026-09-05: 50 scenarios, 185 checks, identical on both sides; the 37 scored scenarios of the frozen `2026-07-28` set all pass; the 36 failing checks sit in 11 of the 13 unscored scenarios (ten `tasks-*` extension scenarios and three `pending` diagnostics, two of which fail) and fail identically with and without instrumentation. The client scenario `request-metadata` passes 8 of 8 against the instrumented example client: `traceparent` is added next to the three `io.modelcontextprotocol/*` keys, which stay intact. Results are in `test/integration/results/conformance/`; `examples/http/README-adaptations.md` lists how the example differs from the reference server of the suite.

## Demo in three minutes

```sh
docker run --rm --name jaeger -p 16686:16686 -p 4317:4317 -p 4318:4318 cr.jaegertracing.io/jaegertracing/jaeger:2.20.0
git clone https://github.com/AmirK-S/mcp-opentelemetry && cd mcp-opentelemetry && npm ci
npm run example:stdio
```

The client prints the trace id and the Jaeger link. The trace shows `agent`, the client span `tools/call get-weather`, the server span with the same name in the other process, and the `lookup-forecast` span created inside the tool.

## Where this sits in the ecosystem

Measured on 2026-09-06 by reading the published code of each package, never its README; `scripts/measure-ecosystem.sh` downloads every package and runs the greps behind each cell. Reference: `open-telemetry/semantic-conventions-genai`, `docs/gen-ai/mcp.md` at revision `94f432d` (2026-09-03). "Required" is `mcp.method.name`; "conditional" are the six conditionally required attributes (`error.type`, `gen_ai.prompt.name`, `gen_ai.tool.name`, `jsonrpc.request.id`, `mcp.resource.uri`, `rpc.response.status_code`); "off-convention" counts attribute keys the convention does not define.

| Package | Version (date) | Targets | Propagates via `_meta` | Spans | Convention attributes (required present/missing) | Notifications | Metrics | Content capture default | Last release |
|---|---|---|---|---|---|---|---|---|---|
| `mcp-opentelemetry` (this) | 0.1.0 | TS SDK 2.x, protocol `2026-07-28` | yes, client-initiated requests only | CLIENT + SERVER, `{method} {target}` | 1/1 required, 6/6 conditional, 0 off-convention | no | none | off (`captureArguments`, `captureResults`) | n/a |
| `mcp` (Python SDK, built in) | 2.1.1 (2026-08-25) | itself | yes, requests only (outbound); extracts on requests and notifications | CLIENT + SERVER; server name conforms, client name prefixed `MCP send` | 1/1 required, 5/6 conditional (`mcp.resource.uri` missing), 0 off-convention | inbound only | none | off | 2026-08-25 |
| `@arizeai/openinference-instrumentation-mcp` | 0.2.30 (2026-09-04) | TS SDK 1.x | yes, requests only | none | no attributes | no (by design) | none | n/a | 2026-09-04 |
| `openinference-instrumentation-mcp` (Python) | 2.0.9 (2026-09-04) | `mcp >= 1.24.0` | yes, requests only | none | no attributes | no | none | n/a | 2026-09-04 |
| `@monocle.sh/instrumentation-mcp` | 1.0.2 (2026-05-17) | TS SDK 1.x | no | SERVER + CLIENT, `{method} {target}` (resource URI in the name by default) | 1/1 required, 1/6 conditional, 15 off-convention | yes, both directions | none | off (`recordInputs`, `recordOutputs`) | 2026-05-17 |
| `@shinzolabs/instrumentation-mcp` | 1.1.0 (2025-12-01) | TS SDK `^1.15.1` | no | INTERNAL (no kind), `{method} {tool}` | 1/1 required, 1/6 conditional, 3 off-convention | no (stubbed `// TODO`) | `mcp.server.operation.duration` (declared in ms, not s) and `mcp.server.session.duration` (declared in s, recorded in ms) + a per-tool counter with a dynamic name | off (`enableArgumentCollection`) | 2025-12-01 |
| `mcp-otel` | 0.1.1 (2026-06-21) | TS SDK `>=1.10.0 <2` | inject exported but never wired; extracts on the server | SERVER, `{method} {tool}` | 0/1 required (`mcp.method` not `mcp.method.name`), 0/6 conditional, 3 off-convention | no | none | none | 2026-06-21 |
| `opentelemetry-instrumentation-mcp` (Traceloop, Python) | 0.62.3 (2026-08-10) | `mcp >= 1.6.0` | partial: `traceparent` only, and only when `_meta` already exists | no kind, `{tool}.tool` / `{method}.mcp` | 0/1 required, 1/6 conditional, 6 off-convention | no | none | **on** | 2026-08-10 |
| `@traceloop/instrumentation-mcp` | 0.27.0 (2026-06-01) | TS SDK `>=1.0.0` | no | CLIENT + SERVER, `{tool}.tool` / `{method}.mcp` | 0/1 required, 0/6 conditional, 4 off-convention | no | none | **on** (`traceContent`) | 2026-06-01 |
| `logfire` (MCP part) | 5.0.0 (2026-09-04) | Python `mcp` | yes, requests **and** notifications | no kind, `MCP request: {method} {tool}` | 0/1 required, 0/6 conditional, 5 off-convention | propagated; only logging notifications recorded | none | **on**, not separately switchable | 2026-09-04 |
| `mcp-trace` | 0.2.0 (2025-10-29) | TS SDK `^1.15.0` | no | no kind, `{type} {method} {entity}` (OTLP adapter only) | 0/1 required, 0/6 conditional, 16 off-convention | logged both ways, not typed | none | **on** (`logFields`) | 2025-10-29 |
| `@theharithsa/opentelemetry-instrumentation-mcp` | 1.0.4 (2025-09-26) | `@modelcontextprotocol/sdk >=0.0.0` | no | no kind, `mcp.tool:{name}` | 0/1 required, 0/6 conditional, 0 attributes | no | none | none | 2025-09-26 |
| `@modelcontextprotocol/{core,client,server}` (TS SDK) | 2.0.0 (2026-07-27) | itself | constants only (`TRACEPARENT_META_KEY`, `TRACESTATE_META_KEY`, `BAGGAGE_META_KEY`) | none | n/a | n/a | none | n/a | 2026-07-27 |

Two packages propagate the context and set the required attribute: the Python SDK and this one. This one is the only measured package that applies the complete parenting rule (remote parent plus a link to the ambient context) and whose attribute keys are all in the convention; it is also missing the whole server-initiated direction, every notification and every metric, which the table shows.

The MCP TypeScript SDK itself exports the three key constants and a passthrough test since PR #2270, and nothing else: no span, no injection, no extraction. The tracking issue #2196 carries a scoping comment recommending that this live in a middleware package rather than in the SDK core, with `@opentelemetry/api` kept out of the published packages' hard dependencies. This package takes that shape from the outside.

## Roadmap

1. Requests the server initiates: `sampling/createMessage`, `elicitation/create`, `roots/list`.
2. `notifications/progress` and `notifications/cancelled`: inject from the active span, `PRODUCER` spans.
3. The four duration metrics of the convention.
4. A measured overhead figure per request.

## Contributing, issues and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Issues get an answer within seven days; that answer is not a commitment to ship what is asked. The roadmap above is what the author intends to do, in that order.

## References

- MCP specification `2026-07-28`, `_meta` and reserved keys: https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta
- SEP-414, OpenTelemetry trace context propagation conventions: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/414-request-meta.md
- OpenTelemetry semantic conventions for MCP: https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md
- W3C Trace Context: https://www.w3.org/TR/trace-context/ and W3C Baggage: https://www.w3.org/TR/baggage/

## License

MIT. See [LICENSE](LICENSE).
