import type { TextMapPropagator, TracerProvider } from '@opentelemetry/api';
import type { Connectable, TransportLike } from './types.js';

export type { Connectable, TransportLike } from './types.js';
export * from './keys.js';
export * from './semconv.js';
export { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

export interface McpInstrumentationOptions {
  /** Defaults to the global tracer provider of `@opentelemetry/api`. */
  tracerProvider?: TracerProvider | undefined;
  /** Defaults to the global propagator of `@opentelemetry/api`. */
  propagator?: TextMapPropagator | undefined;
  /** Record `gen_ai.tool.call.arguments`. Off by default: arguments may be sensitive. */
  captureArguments?: boolean | undefined;
  /** Record `gen_ai.tool.call.result`. Off by default: results may be sensitive. */
  captureResults?: boolean | undefined;
  /** Value of `network.transport`, e.g. `pipe` for stdio or `tcp` for HTTP. Detected from the transport class when omitted. */
  networkTransport?: string | undefined;
  /** Value of `server.address`, for HTTP transports. */
  serverAddress?: string | undefined;
  /** Value of `server.port`, for HTTP transports. */
  serverPort?: number | undefined;
}

/** Instrument a transport that a `Client` will connect to. Returns the same object. */
export function instrumentClientTransport<T extends TransportLike>(transport: T, _options: McpInstrumentationOptions = {}): T {
  return transport;
}

/** Instrument a transport that a `Server` or `McpServer` will connect to. Returns the same object. */
export function instrumentServerTransport<T extends TransportLike>(transport: T, _options: McpInstrumentationOptions = {}): T {
  return transport;
}

/** Patch `client.connect` so that every transport it connects to is instrumented. Returns the same object. */
export function instrumentClient<T extends Connectable>(client: T, _options: McpInstrumentationOptions = {}): T {
  return client;
}

/** Patch `server.connect` so that every transport it connects to is instrumented. Returns the same object. */
export function instrumentServer<T extends Connectable>(server: T, _options: McpInstrumentationOptions = {}): T {
  return server;
}

/** True when the transport has already been instrumented by this package. */
export function isInstrumented(_transport: TransportLike): boolean {
  return false;
}
