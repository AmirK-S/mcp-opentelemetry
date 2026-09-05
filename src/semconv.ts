/**
 * Attribute and metric names used by this package.
 *
 * Why they live here and not in `@opentelemetry/semantic-conventions`:
 * every `mcp.*` and `gen_ai.*` constant of that package is marked deprecated
 * since 1.42.0 ("Moved to the OpenTelemetry GenAI semantic conventions
 * repository"), frozen on protocol revision 2025-06-18, and no package is
 * generated from the GenAI repository yet. The strings below are checked
 * against `@opentelemetry/semantic-conventions@1.43.0` by `test/semconv.test.ts`
 * so that any divergence is caught, without shipping the deprecated import.
 *
 * Reference: https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md
 */

/** The name of the request or notification method, e.g. `tools/call`. */
export const ATTR_MCP_METHOD_NAME = 'mcp.method.name';
/** The negotiated protocol revision, e.g. `2026-07-28`. */
export const ATTR_MCP_PROTOCOL_VERSION = 'mcp.protocol.version';
/** The uri of the resource for `resources/read`. */
export const ATTR_MCP_RESOURCE_URI = 'mcp.resource.uri';

/** Name of the tool for `tools/call`. */
export const ATTR_GEN_AI_TOOL_NAME = 'gen_ai.tool.name';
/** Operation name; `execute_tool` for `tools/call`. */
export const ATTR_GEN_AI_OPERATION_NAME = 'gen_ai.operation.name';
/** Name of the prompt for `prompts/get`. */
export const ATTR_GEN_AI_PROMPT_NAME = 'gen_ai.prompt.name';
/** Serialized tool arguments; opt-in, may contain sensitive data. */
export const ATTR_GEN_AI_TOOL_CALL_ARGUMENTS = 'gen_ai.tool.call.arguments';
/** Serialized tool result; opt-in, may contain sensitive data. */
export const ATTR_GEN_AI_TOOL_CALL_RESULT = 'gen_ai.tool.call.result';

export const GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL = 'execute_tool';

/** JSON-RPC request id, always as a string. */
export const ATTR_JSONRPC_REQUEST_ID = 'jsonrpc.request.id';
/** JSON-RPC protocol version, always `2.0`. */
export const ATTR_JSONRPC_PROTOCOL_VERSION = 'jsonrpc.protocol.version';
/** JSON-RPC error code as a string, on error responses only. */
export const ATTR_RPC_RESPONSE_STATUS_CODE = 'rpc.response.status_code';

/** Error class: a JSON-RPC error code as a string, or `tool_error` when the result carries `isError`. */
export const ATTR_ERROR_TYPE = 'error.type';
export const ERROR_TYPE_VALUE_TOOL_ERROR = 'tool_error';

export const ATTR_NETWORK_TRANSPORT = 'network.transport';
export const ATTR_SERVER_ADDRESS = 'server.address';
export const ATTR_SERVER_PORT = 'server.port';

export const METRIC_MCP_CLIENT_OPERATION_DURATION = 'mcp.client.operation.duration';
export const METRIC_MCP_SERVER_OPERATION_DURATION = 'mcp.server.operation.duration';
export const METRIC_MCP_CLIENT_SESSION_DURATION = 'mcp.client.session.duration';
export const METRIC_MCP_SERVER_SESSION_DURATION = 'mcp.server.session.duration';
