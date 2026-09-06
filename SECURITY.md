# Security

## What leaves your process

By default, for every request, the spans carry: the method name, the JSON-RPC id, the tool name (`tools/call`), the prompt name (`prompts/get`), the resource uri as an attribute (`resources/read`), the negotiated protocol version, the transport kind, and the error class. On the wire, `params._meta` gains `traceparent`, `tracestate`, and `baggage`.

- `baggage` is whatever your OpenTelemetry context holds. It is sent in clear to the peer. Do not put secrets in baggage.
- Tool arguments and results are not recorded unless you set `captureArguments` or `captureResults`. Both are off by default because they can contain user data.
- The resource uri is not part of the span name unless you set `resourceUriInSpanName`; it can carry a path.

## Reporting a vulnerability

Open a private security advisory on GitHub (Security tab of the repository), or email the maintainer address listed on the npm package page. You will get an answer within seven days.
