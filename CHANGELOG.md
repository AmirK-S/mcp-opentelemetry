# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `instrumentClientTransport`, `instrumentServerTransport`, `instrumentClient`, `instrumentServer`, `isInstrumented`.
- W3C Trace Context and Baggage propagation through `params._meta` (`traceparent`, `tracestate`, `baggage`), injected on the client, extracted on the server, as reserved by MCP `2026-07-28` (SEP-414).
- `CLIENT` and `SERVER` spans per request, named `{method} {target}`, with the attributes of the OpenTelemetry semantic conventions for MCP: `mcp.method.name`, `mcp.protocol.version`, `jsonrpc.request.id`, `jsonrpc.protocol.version`, `gen_ai.tool.name`, `gen_ai.operation.name`, `gen_ai.prompt.name`, `mcp.resource.uri`, `error.type`, `rpc.response.status_code`, `network.transport`, `server.address`, `server.port`, and opt-in `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result`.
- Parenting rule of the convention: carried context is the parent, ambient context is a link; fallback to the ambient context on a malformed `traceparent`.
- Server side rewrite of the inbound `traceparent` to the server span, so downstream extractions parent correctly.
- Pending spans closed with `error.type=connection_closed` when the transport closes.
- Offline test suite, two-process stdio integration test, Jaeger end-to-end test, conformance comparison script.
- Stdio example with a Jaeger demo.

### Known limits

- Notifications are passed through without injection. No metrics. ESM only.
- HTTP requests rejected before the transport produce no span.

