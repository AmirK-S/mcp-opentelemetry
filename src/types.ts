/**
 * Minimal structural types. The package does not import the MCP SDK at
 * runtime: it only needs the shape of a JSON-RPC message and of a transport,
 * and both are stable across the v2 packages. See DECISIONS D-006.
 */

export type RequestId = string | number;

export interface JsonRpcParams {
  _meta?: Record<string, unknown> | undefined;
  [key: string]: unknown;
}

export interface JsonRpcRequestLike {
  jsonrpc: '2.0';
  id: RequestId;
  method: string;
  params?: JsonRpcParams | undefined;
}

export interface JsonRpcNotificationLike {
  jsonrpc: '2.0';
  method: string;
  params?: JsonRpcParams | undefined;
}

export interface JsonRpcResultLike {
  jsonrpc: '2.0';
  id: RequestId;
  result: { _meta?: Record<string, unknown> | undefined; [key: string]: unknown };
}

export interface JsonRpcErrorLike {
  jsonrpc: '2.0';
  id: RequestId | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessageLike = JsonRpcRequestLike | JsonRpcNotificationLike | JsonRpcResultLike | JsonRpcErrorLike;

/**
 * The subset of the SDK `Transport` interface this package relies on.
 * Every transport shipped by `@modelcontextprotocol/client` and
 * `@modelcontextprotocol/server` 2.x satisfies it.
 */
export interface TransportLike {
  start(): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(message: any, options?: any): Promise<void>;
  close(): Promise<void>;
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onmessage?: ((message: any, extra?: any) => void) | undefined;
  sessionId?: string | undefined;
}

/** Anything with a `connect(transport)` method: `Client`, `Server`, `McpServer`. */
export interface Connectable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connect(transport: any, ...rest: any[]): Promise<void>;
}
