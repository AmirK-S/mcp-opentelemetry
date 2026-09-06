# Real-world run against a third-party MCP server

A run of this package against an MCP server it was not written for and that is not
one of its fixtures: HiveMind, a Python server built on `fastmcp` 2.14.5 over
`mcp` 1.26.0, speaking Streamable HTTP. Nothing in the HiveMind repository was
modified for this run.

Written as the run happened, in order. Times are local, 2026-09-06.

## Setup

- Jaeger 2.20.0 in Docker, OTLP/HTTP on 4318, UI and query API on 16686.
- HiveMind checkout with `docker-compose.yml` (server + PostgreSQL/pgvector + Redis).
- This package at 0.2.0, client `@modelcontextprotocol/client` 2.0.0.

## 07:14 to 07:25, starting HiveMind

The server did not start from a clean checkout: the image build and the database migrations needed seven local fixes (a missing `.env`, a `Dockerfile` copy, a spaCy model, an import in the migration script, a duplicated enum, a driver name, a missing table). All of them were applied outside the checkout, in a copied `Dockerfile` and a `PYTHONPATH` shim, and reported to that project. None concerns this package. The MCP endpoint is `/mcp/mcp`, because the FastAPI mount and the FastMCP path are both `/mcp`.

## The run

```sh
HIVEMIND_TOKEN=<jwt> MCP_OTEL_STDERR_SPANS=1 npx tsx examples/hivemind/client.ts
```

`examples/hivemind/client.ts` connects a `StreamableHTTPClientTransport` to
`http://localhost:8000/mcp/mcp` through `instrumentClientTransport`, opens a
root span `agent`, calls `listTools()` and then `search_knowledge`, the one read
that writes nothing. HiveMind takes its auth from the HTTP `Authorization`
header, so the transport carries a bearer JWT signed with the server's secret;
without it the tool returns `isError`, which is a span too, but a less
interesting one.

Output, trimmed:

```
tools: add_knowledge, search_knowledge, list_knowledge, delete_knowledge,
       publish_knowledge, manage_roles, report_outcome
search_knowledge isError=false [{"type":"text","text":"{\"results\":[],\"total_found\":0,\"next_cursor\":null}"}]
sent initialize              _meta={"traceparent":"00-84e68710...-b01f2568bce687aa-01"}
sent notifications/initialized _meta={"traceparent":"00-7f23e2ff...-bbf96a2abcf8e7a7-01"}
sent tools/list              _meta={"traceparent":"00-fc97fa6edff4d0efd9cba413be269088-64668e83a658f6a5-01"}
sent tools/call              _meta={"traceparent":"00-fc97fa6edff4d0efd9cba413be269088-4134660190057e28-01"}
trace fc97fa6edff4d0efd9cba413be269088
```

The example wraps `transport.send` to print each outbound frame after the
instrumentation has written to it, so the `traceparent` lines above are the wire
itself, not a reconstruction. Every request and the notification carry one, and
the span id in each matches the client span that was open at the time.

`initialize` and `notifications/initialized` are sent by `connect()`, before the
`agent` span exists, so they start traces of their own. That is the documented
behaviour and it is visible here on a real handshake.

## What Jaeger has

Read back through the query API, not the UI:

```sh
curl -s http://localhost:16686/api/traces/fc97fa6edff4d0efd9cba413be269088
```

Saved at [usage-reel/hivemind-trace.json](usage-reel/hivemind-trace.json). One
trace, one process, three spans:

| Span | Kind | Parent |
| --- | --- | --- |
| `agent` | internal | none |
| `tools/list` | client | `agent` |
| `tools/call search_knowledge` | client | `agent` |

The tool call span carries exactly the convention's attributes and nothing else:

```
mcp.method.name        = tools/call
gen_ai.tool.name       = search_knowledge
gen_ai.operation.name  = execute_tool
jsonrpc.request.id     = 2
mcp.protocol.version   = 2025-11-25
network.transport      = tcp
server.address         = localhost
server.port            = 8000
otel.scope.name        = mcp-opentelemetry
```

`mcp.protocol.version` is `2025-11-25`, read off the wire: HiveMind is a 2025-era
server, so the client is constructed with `versionNegotiation: { mode: 'legacy' }`.
A pin to `2026-07-28` would fail loudly, which is what a pin is for; `auto` would
probe with `server/discover`, get nothing usable, and fall back. `legacy` is the
honest setting and costs nothing here, since `params._meta` on requests is a 2025
feature too and the injection works on both eras.

## What is missing for a complete trace

The server half. Three spans in the trace, all from the client process, and
nothing under `tools/call search_knowledge` although a whole hybrid search runs
there.

HiveMind is on `mcp` 1.26.0 with `fastmcp` 2.14.5. Neither package contains the
string `traceparent` anywhere (checked inside the built image), and neither does
HiveMind's own source, which has no `opentelemetry` import at all: the only
`opentelemetry-api` in `uv.lock` is a transitive dependency of `pydocket`. So the
`traceparent` this client puts in `params._meta` arrives, is carried through the
JSON-RPC envelope, and is dropped on the floor. Built-in propagation landed in
the Python SDK's 2.x line; 1.26 predates it.

Nothing is broken by this. The context is on the wire and correct; the far side
simply has no reader. Any of these three closes the gap, in increasing order of
cost: upgrade HiveMind to the Python SDK 2.x, whose transport injects and
extracts on its own; run it under `openinference-instrumentation-mcp`, which
extracts the context but emits no spans of its own, so it needs a span source
next to it; or instrument the tools by hand.

## Bonus, 07:29, the other half of the trace

The gap can be closed without touching the checkout. HiveMind was rebuilt from
the same source with four packages added at image build time and started under
the OpenTelemetry launcher:

```sh
# in the builder stage of the Dockerfile copy
uv pip install --python /app/.venv opentelemetry-distro opentelemetry-exporter-otlp \
  opentelemetry-instrumentation-fastapi opentelemetry-instrumentation-asyncpg \
  openinference-instrumentation-mcp

# and the command
opentelemetry-instrument uvicorn hivemind.server.main:app --host 0.0.0.0 --port 8000
```

with `OTEL_SERVICE_NAME=hivemind-mcp-server`,
`OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318` and
`OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`.

The first attempt produced server spans in traces of their own: four HTTP spans
per exchange, `POST /mcp` and its ASGI children, all roots. That is the expected
half-measure. `openinference-instrumentation-mcp` 2.0.9 wraps the message stream
of `mcp.server.streamable_http`, reads `request.params["_meta"]`, calls
`propagate.extract` on it and attaches the result. It creates no span of its own,
by design. The ASGI spans are opened before MCP has parsed the body, so they
cannot be children of a context nobody has read yet, and nothing was running
inside the extracted context to show it.

Adding `opentelemetry-instrumentation-asyncpg`, so that the database work inside
the tool produces spans, is what makes the extraction visible. Same client, same
`search_knowledge` call, one trace:

```
mcp-example-hivemind-client | agent
mcp-example-hivemind-client |   tools/list
mcp-example-hivemind-client |   tools/call search_knowledge
hivemind-mcp-server         |     connect
hivemind-mcp-server         |     BEGIN;
hivemind-mcp-server         |     WITH ... (the hybrid search queries)
hivemind-mcp-server         |     ROLLBACK;
```

Saved at
[usage-reel/hivemind-trace-instrumented.json](usage-reel/hivemind-trace-instrumented.json).
The seven server spans name the client's `tools/call` span as their parent, in
another process, in another language, from a `traceparent` that travelled in
`params._meta` and nowhere else. The client never sent a `traceparent` HTTP
header; there is nothing else the server could have read.

What is still missing at that point is the MCP server span itself. Between the
client's `tools/call search_knowledge` and the SQL there should be a `SERVER` span
named `tools/call search_knowledge`, holding `mcp.method.name` and the rest, with
the tool's own work beneath it. No package in the Python ecosystem produces it at
this MCP version: `openinference` propagates without emitting, and the built-in
spans arrived in the Python SDK's 2.x line, which HiveMind is not on. That span
is what this package does on the TypeScript side.

## Summary

| | |
| --- | --- |
| Server | HiveMind, Python, `fastmcp` 2.14.5 on `mcp` 1.26.0, Streamable HTTP at `/mcp/mcp`, protocol `2025-11-25` |
| Client | `@modelcontextprotocol/client` 2.0.0, `versionNegotiation: 'legacy'`, instrumented by this package at 0.2.0 |
| Client spans | complete: `agent`, `tools/list`, `tools/call search_knowledge`, convention attributes, no extra keys |
| Propagation | `traceparent` written into `params._meta` on every request and on `notifications/initialized`, confirmed on the wire |
| Server spans, as shipped | none; `mcp` 1.26 and `fastmcp` 2.14.5 contain no `traceparent` handling and HiveMind imports no OpenTelemetry |
| Server spans, under `opentelemetry-instrument` | present and correctly parented once a span source runs inside the tool |
| Blocking bugs found in HiveMind | seven, listed above; none in this package |

Nothing had to be changed in this package for the run. The client example added
by it is `examples/hivemind/client.ts`.
