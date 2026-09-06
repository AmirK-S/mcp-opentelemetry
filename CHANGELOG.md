# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-06

### Added

- Requests initiated by the server (`sampling/createMessage`, `elicitation/create`, `roots/list`, `ping`): the server side opens a `CLIENT` span under the active server span and injects `params._meta`; the client side opens a `SERVER` span parented to it and runs the handler inside it. Both transports now handle both directions, so `instrumentClientTransport` and `instrumentServerTransport` differ only in the role recorded on the object.
- Notifications: the context is injected into `params._meta` of every outgoing notification and extracted from every incoming one; a `CLIENT` span on the emitter and a `SERVER` span on the receiver, named after the method. `notifications/cancelled` is parented to the span of the request it cancels, which is closed with `error.type` `cancelled`. Option `instrumentNotifications` to turn this off.

## [0.1.0] - 2026-09-06

### Added

- `instrumentClientTransport`, `instrumentServerTransport`, `instrumentClient`, `instrumentServer`, `isInstrumented`.
- W3C Trace Context and Baggage propagation through `params._meta` (`traceparent`, `tracestate`, `baggage`), injected on the client, extracted on the server, as reserved by MCP `2026-07-28` (SEP-414).
- `CLIENT` and `SERVER` spans per request, named `{method} {target}`, with the attributes of the OpenTelemetry semantic conventions for MCP: `mcp.method.name`, `mcp.protocol.version`, `jsonrpc.request.id`, `jsonrpc.protocol.version`, `gen_ai.tool.name`, `gen_ai.operation.name`, `gen_ai.prompt.name`, `mcp.resource.uri`, `error.type`, `rpc.response.status_code`, `network.transport`, `server.address`, `server.port`, and opt-in `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result`.
- Parenting rule of the convention: carried context is the parent, ambient context is a link; fallback to the ambient context on a malformed `traceparent`.
- Server side rewrite of the inbound `traceparent` to the server span, so downstream extractions parent correctly.
- Pending spans closed with `error.type=connection_closed` when the transport closes.
- Offline test suite, two-process stdio integration test, Jaeger end-to-end test, conformance comparison script.
- Stdio example with a Jaeger demo; HTTP example server used by the conformance comparison.
- `resourceUriInSpanName` option, off by default as the convention asks.
- `SECURITY.md`, `CONTRIBUTING.md`, end-of-life note.

Not covered in this release:

- Not yet covered: requests the server initiates (`sampling/createMessage`, `elicitation/create`, `roots/list`) get no span and no `traceparent`; planned for 0.2.0.
- Notifications are passed through without injection. No metrics. ESM only.
- HTTP requests rejected before the transport produce no span.

[Unreleased]: https://github.com/AmirK-S/mcp-opentelemetry/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/AmirK-S/mcp-opentelemetry/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/AmirK-S/mcp-opentelemetry/releases/tag/v0.1.0
