# examples/http: what changes from the reference everything-server

`examples/http/server.ts` is derived from the reference server of the
`modelcontextprotocol/conformance` repository
(`examples/servers/typescript/everything-server.ts`). The reference targets
`@modelcontextprotocol/sdk@^1.29.0` with Express; this repository uses the SDK v2
(`@modelcontextprotocol/{core,client,server,node}@2.0.0`) and `node:http`. The
adaptations are the following.

| Reference, SDK 1.x | Here, SDK 2.0.0 | Why |
| --- | --- | --- |
| `createMcpExpressApp` plus one `StreamableHTTPServerTransport` per session, plus an `InMemoryTransport` bridge to serve stateless requests | `createMcpHandler(factory)` plus `toNodeHandler` | The SDK v2 serves revision 2026-07-28 statelessly by design: one instance per request, built by the factory. The in-memory bridge of the reference no longer exists. |
| `cors` plus Express | The `localhostHostValidation()` and `localhostOriginValidation()` guards of `@modelcontextprotocol/node` | `node:http` has no middleware chain: each guard answers by itself and returns `false` when the request must not be processed further. |
| A wrapper around `setRequestHandler` adding `ttlMs` and `cacheScope` to list results | The `ServerOptions.cacheHints` option and `registerResource(..., { cacheHint })` | SEP-2549 is a declarative option in the SDK v2. |
| A hand-written HMAC (`signMrtState`, `verifyMrtState`) for `requestState` | `createRequestStateCodec` plus `ServerOptions.requestState.verify` | The SDK v2 ships the HMAC codec and the verification hook; a tampered state yields the frozen `-32602` expected by `input-required-result-tampered-state`. |
| `InputRequiredResult` objects written by hand | `inputRequired(...)`, `inputRequired.elicit/createMessage/listRoots`, `acceptedContent`, `inputResponse` | Multi round trips (SEP-2322) are native in the SDK v2. |
| `sendNotification({ method: 'notifications/progress', ... })` from `extra` | `ctx.mcpReq.notify(...)` and `ctx.mcpReq.log(...)` | The handler context changed shape between v1 and v2. |
| `test_missing_capability` throws | `test_missing_capability` returns `inputRequired({ inputRequests: { ...createMessage } })` | In the SDK v2 an error thrown in a tool callback becomes an `isError` result, never a JSON-RPC error. The `-32021` can only come from the capability check of the `input_required` seam, which compares each embedded request with the capabilities declared in the `_meta` envelope of the request. |
| `completions: {}` declared in the capabilities | In addition, a `completable(...)` argument on `test_prompt_with_arguments` | `McpServer` v2 installs the `completion/complete` handler only when at least one registered argument is completable. Declaring the capability alone leaves the method answering `-32601`. |
| Prompts registered without `argsSchema` | `test_input_required_result_prompt` keeps the runtime `(ctx)` callback and bypasses the overload with `as never` | The `Args` generic of `registerPrompt` has no `undefined` default: without `argsSchema` the typing announces `(args, ctx)` while the runtime calls `(ctx)`. Declaring `z.object({})` would reject a `prompts/get` without `arguments`, which the scenario sends. |

Tools, resources and prompts not carried over, all outside the scored set for
`2026-07-28`:

- `json_schema_2020_12_tool` (scenario `json-schema-2020-12`, marked `pending`).
- The `x-mcp-header` annotated tools of SEP-2243 (scenario
  `http-custom-header-server-validation`, marked `pending`).
- The whole `tasks/*` family of SEP-2663 (`greet`, `slow_compute`,
  `failing_job`, `confirm_delete`, ...), marked `extension`.
- `test_reconnection` (SEP-1699), `test_sampling`, `test_elicitation`: outside the
  scored 2026-07-28 set, or superseded by the multi round trip flow.
