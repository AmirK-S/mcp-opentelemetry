# mcp-opentelemetry

OpenTelemetry instrumentation for the MCP TypeScript SDK v2 (`@modelcontextprotocol/client`, `@modelcontextprotocol/server` 2.x), protocol revision `2026-07-28`.

It does two things the SDK leaves to you:

1. **Propagation.** The W3C Trace Context of the caller travels in `params._meta` under the keys `traceparent`, `tracestate` and `baggage`, exactly as the specification reserves them (SEP-414). Injected on the client, extracted on the server.
2. **Spans.** One `CLIENT` span per request on the client, one `SERVER` span per request on the server, named and attributed after the [OpenTelemetry semantic conventions for MCP](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md). The server span is active while your tool runs, so the spans your tool creates hang below it.

The result is a single trace, agent to tool to server code, in Jaeger or any OTLP backend.

No fork, no `--require`, no global patching of modules: you hand the transport to one function and see where the instrumentation hooks in.

## Status

- Version 0.1.0. Targets `@modelcontextprotocol/*` 2.0.0, the first release line that speaks `2026-07-28`. The 1.x SDK is not supported.
- Requests only: `tools/call`, `tools/list`, and every other request get a span; `prompts/get` and `resources/read` also carry their name or uri. Notifications and metrics are not instrumented yet (see Roadmap).
- The MCP semantic conventions are at status Development and may change. Attribute names live in one module of this package, checked by a test against `@opentelemetry/semantic-conventions` 1.43.0. Read [docs/END-OF-LIFE.md](docs/END-OF-LIFE.md) before depending on this in production.

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
| `networkTransport` | detected from the transport class | value of `network.transport` (`pipe` for stdio, `tcp` for HTTP) |
| `serverAddress`, `serverPort` | unset | values of `server.address` and `server.port` |

Applying the package twice to the same object is a no-op.

## What you get

### Spans

| Side | Kind | Name | Starts | Ends |
| --- | --- | --- | --- | --- |
| client | `CLIENT` | `{method} {target}` | when the request is handed to the transport | when the matching response arrives, or the transport closes |
| server | `SERVER` | `{method} {target}` | when the request arrives from the transport | when the response has been written, or the transport closes |

`target` is the tool name for `tools/call`, the prompt name for `prompts/get`, the uri for `resources/read`, and absent otherwise, so `tools/list` is named `tools/list` and a tool call is named `tools/call get-weather`.

### Attributes

| Attribute | When | Value |
| --- | --- | --- |
| `mcp.method.name` | always | `tools/call`, `tools/list`, ... |
| `jsonrpc.request.id` | always | the id, as a string |
| `jsonrpc.protocol.version` | always | `2.0` |
| `mcp.protocol.version` | when known | from `io.modelcontextprotocol/protocolVersion` in `_meta`, or from the `initialize` result on legacy connections |
| `gen_ai.tool.name` | `tools/call` | the tool name |
| `gen_ai.operation.name` | `tools/call` | `execute_tool` |
| `gen_ai.prompt.name` | `prompts/get` | the prompt name |
| `mcp.resource.uri` | `resources/read` | the uri |
| `error.type` | on failure | the JSON-RPC error code as a string, `tool_error` when the result carries `isError`, `connection_closed` when the transport closed first |
| `rpc.response.status_code` | JSON-RPC error | the error code as a string |
| `network.transport` | when known | `pipe`, `tcp` |
| `server.address`, `server.port` | when given | as given |
| `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` | opt-in | JSON |

The span status is `ERROR` on a JSON-RPC error and on `isError`, `UNSET` otherwise.

`mcp.session.id` is not recorded: revision `2026-07-28` removed protocol sessions.

### Parenting

- The context carried by `_meta` is the parent of the server span. An ambient context on the server, for instance the span of the incoming HTTP request opened by another instrumentation, becomes a **link**, not a parent, as the convention asks. Transport and MCP contexts are independent.
- When `_meta` carries no context, or an invalid one, the ambient context is the parent, and a new trace starts if there is none. A malformed `traceparent` never fails the call and never orphans the span. Baggage is extracted even without a `traceparent`.
- On the server the package rewrites the inbound `traceparent` so that it names the server span. Anything that extracts `_meta` again downstream, a second instrumentation or a handler forwarding the request, parents under the server span. The trace id does not change. Every other `_meta` key is left untouched.
- The client never replaces `_meta`: it adds its three keys to whatever the SDK and the caller put there, so the required `io.modelcontextprotocol/*` keys of `2026-07-28` survive.

### Size

A complete `_meta` with the required envelope, a 512 character `tracestate` and an 8192 byte `baggage` weighs 8 917 bytes. The lowest transport bound in the ecosystem is the 100 KiB default of `express.json()`; the SDK stdio buffer is 10 MiB. `@opentelemetry/core` already caps `baggage` at 8192 bytes and `tracestate` at 512 characters when injecting, silently; the package logs a debug line through `diag` when entries are dropped.

## Known limits

- HTTP requests rejected before the transport (missing `Mcp-Method` header, wrong era, 405) never reach the instrumentation and produce no span. Put an HTTP instrumentation in front if you need them.
- Notifications (`notifications/progress`, `notifications/cancelled`) are passed through unchanged for now.
- Hosts that send no `traceparent` start the trace at the server. Measured on 05/09/2026: Claude Code 2.1.261 speaks `2025-11-25` and puts only `progressToken` and `claudecode/toolUseId` in `_meta`, so a server behind it produces root spans, one per tool call.
- No metrics yet. The four duration metrics of the convention are the next step.
- ESM only. The SDK 2.x is ESM first; a CommonJS build can be added if someone needs it.
- Instrument a transport before `connect()`. Applied later, the package wraps the callbacks already installed, but the messages that went through before are not seen.

## How it is tested

Everything below runs with `npm test`, offline, transport and exporter in memory:

- one test per protocol message of the scope: request, result, JSON-RPC error, `tools/list`, with the exact attributes and the parent relations checked span by span;
- twelve malformed `traceparent` values (version `ff`, all-zero ids, wrong lengths, non-strings) with and without an ambient context, plus `tracestate` above 32 entries and malformed `baggage`: the call succeeds, the span is never orphaned;
- idempotence, and coexistence with a propagation-only wrapper in both orders on both sides;
- the internal attribute names and `_meta` keys against the published constants.

The tests fail when they should: with extraction disabled, 16 tests go red; with span naming broken, 55; with injection removed, 8; with the context not activated around the dispatch, 4.

`npm run test:integration` adds two real processes over stdio, then the same through Jaeger with the trace read back from its API. The trace of the last run is in `test/integration/results/jaeger-trace.json`.

The official conformance suite, `@modelcontextprotocol/conformance` 0.2.0-alpha.11 with `--requirements 2026-07-28`, runs against the HTTP example server (`examples/http/server.ts`) with and without instrumentation; `npm run conformance` compares both runs and fails on any difference. Last run, 05/09/2026: 50 scenarios, 185 checks, identical on both sides; the 37 scored scenarios of the frozen `2026-07-28` set all pass; the 36 failing checks sit in 13 unscored scenarios (`tasks-*` extension, two `pending` diagnostics) and fail identically with and without instrumentation. The client scenario `request-metadata` passes 8 of 8 against the instrumented example client: `traceparent` is added next to the three `io.modelcontextprotocol/*` keys, which stay intact. Results are in `test/integration/results/conformance/`.

## Demo in three minutes

```sh
docker run --rm --name jaeger -p 16686:16686 -p 4317:4317 -p 4318:4318 cr.jaegertracing.io/jaegertracing/jaeger:2.20.0
git clone https://github.com/AmirK-S/mcp-opentelemetry && cd mcp-opentelemetry && npm ci
npm run example:stdio
```

The client prints the trace id and the Jaeger link. The trace shows `agent`, the client span `tools/call get-weather`, the server span with the same name in the other process, and the `lookup-forecast` span created inside the tool.

## Where this sits in the ecosystem

Measured on 05/09/2026 by reading each package from the registry. "Propagates" means the W3C context crosses the process boundary in `params._meta`; "convention" means the span names and attributes follow the OpenTelemetry MCP conventions.

| Package | Version, date | Targets | Propagates | Spans | Convention | Notifications | Metrics |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `mcp-opentelemetry` (this) | 0.1.0 | SDK TS 2.x, `2026-07-28` | yes | client and server | yes | not yet | not yet |
| `@arizeai/openinference-instrumentation-mcp` | 0.2.30, 04/09/2026 | SDK TS 1.x | yes | none | no attributes | ignored on purpose | no |
| `@traceloop/instrumentation-mcp` | 0.27.0, 01/06/2026 | SDK TS 1.x | no | yes, `{tool}.tool`, `{method}.mcp` | proprietary `traceloop.*` | no | no |
| `@shinzolabs/instrumentation-mcp` | 1.1.0, 01/12/2025 | SDK TS 1.x | not measured | not measured | not measured | no | no |
| `mcp-otel` | 0.1.1, 21/06/2026 | SDK TS 1.x | server side only | server only, per handler | `mcp.tool.name`, `mcp.request.id`, `mcp.method` | no | no |
| `mcp-trace` | 0.2.0, 29/10/2025 | SDK TS 1.x | no | logging to files and OTLP | no | no | no |
| `mcp` (Python SDK, built in) | 2.1.1, 24/08/2026 | Python | yes | client and server, on by default | server yes, client span named `MCP send ...` | no | no |
| `openinference-instrumentation-mcp` (Python) | 2.0.9, 04/09/2026 | Python | yes | none | no attributes | no | no |

The MCP TypeScript SDK itself exports the three key constants and a passthrough test since PR #2270, and nothing else: no span, no injection, no extraction. The maintainers' own framing in issue #2196 is that this belongs in a separate package with `@opentelemetry/api` as a peer, which is what this is.

## Roadmap

1. `notifications/progress` and `notifications/cancelled`: inject from the active span, `PRODUCER` spans.
2. The four duration metrics of the convention.
3. A dashboard example.

## References

- MCP specification `2026-07-28`, `_meta` and reserved keys: https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta
- SEP-414, OpenTelemetry trace context propagation conventions: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/414-request-meta.md
- OpenTelemetry semantic conventions for MCP: https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md
- W3C Trace Context: https://www.w3.org/TR/trace-context/ and W3C Baggage: https://www.w3.org/TR/baggage/

## License

MIT. See [LICENSE](LICENSE).
