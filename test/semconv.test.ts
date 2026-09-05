/**
 * Guards the internal attribute names against the published constants.
 * The published `mcp.*` and `gen_ai.*` constants are deprecated but still
 * present in 1.43.0; if a future version renames or drops them this test
 * is the alarm. See DECISIONS D-005.
 */
import { describe, expect, it } from 'vitest';
import * as incubating from '@opentelemetry/semantic-conventions/incubating';
import * as ours from '../src/semconv.js';

describe('semantic convention strings', () => {
  it.each([
    ['ATTR_MCP_METHOD_NAME', 'mcp.method.name'],
    ['ATTR_MCP_PROTOCOL_VERSION', 'mcp.protocol.version'],
    ['ATTR_MCP_RESOURCE_URI', 'mcp.resource.uri'],
    ['ATTR_GEN_AI_TOOL_NAME', 'gen_ai.tool.name'],
    ['ATTR_GEN_AI_OPERATION_NAME', 'gen_ai.operation.name'],
    ['ATTR_GEN_AI_TOOL_CALL_ARGUMENTS', 'gen_ai.tool.call.arguments'],
    ['ATTR_GEN_AI_TOOL_CALL_RESULT', 'gen_ai.tool.call.result'],
    ['ATTR_JSONRPC_REQUEST_ID', 'jsonrpc.request.id'],
    ['ATTR_JSONRPC_PROTOCOL_VERSION', 'jsonrpc.protocol.version'],
    ['ATTR_RPC_RESPONSE_STATUS_CODE', 'rpc.response.status_code'],
    ['ATTR_ERROR_TYPE', 'error.type'],
    ['ATTR_NETWORK_TRANSPORT', 'network.transport'],
    ['ATTR_SERVER_ADDRESS', 'server.address'],
    ['ATTR_SERVER_PORT', 'server.port'],
    ['METRIC_MCP_CLIENT_OPERATION_DURATION', 'mcp.client.operation.duration'],
    ['METRIC_MCP_SERVER_OPERATION_DURATION', 'mcp.server.operation.duration'],
    ['METRIC_MCP_CLIENT_SESSION_DURATION', 'mcp.client.session.duration'],
    ['METRIC_MCP_SERVER_SESSION_DURATION', 'mcp.server.session.duration'],
  ])('%s matches @opentelemetry/semantic-conventions 1.43.0', (name, value) => {
    const published = (incubating as Record<string, unknown>)[name];
    expect(published, `${name} missing from the published package`).toBe(value);
    expect((ours as Record<string, unknown>)[name]).toBe(value);
  });

  it('execute_tool matches the published enum value', () => {
    expect(incubating.GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL).toBe(ours.GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL);
  });
});
