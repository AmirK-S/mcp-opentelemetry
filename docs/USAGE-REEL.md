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

