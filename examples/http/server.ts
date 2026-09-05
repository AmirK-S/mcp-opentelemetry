/**
 * An MCP server over Streamable HTTP, used to run the official conformance
 * suite (revision 2026-07-28) twice: once bare, once instrumented.
 *
 * Run it bare:
 *   npx tsx examples/http/server.ts
 * Run it instrumented (spans on stderr, no OTLP collector needed):
 *   MCP_OTEL_INSTRUMENT=1 MCP_OTEL_NO_OTLP=1 MCP_OTEL_STDERR_SPANS=1 npx tsx examples/http/server.ts
 *
 * The tools, resources and prompts reproduce the conformance repository's
 * reference everything-server (examples/servers/typescript/everything-server.ts)
 * adapted to SDK 2.0.0. See examples/http/README-adaptations.md for the list of
 * adaptations.
 *
 * SDK 2.0.0 notes, all load-bearing on HTTP:
 *  - `createMcpHandler(factory)` builds a fresh server per request and calls
 *    `server.connect(transport)` internally, so the transport is never visible
 *    here. `instrumentServer(server, ...)` patches `connect` and is therefore
 *    the only entry point that works with this wiring.
 *  - `legacy: 'stateless'` is the default and is kept: the suite's 2026-07-28
 *    leg speaks the modern per-request `_meta` wire, but a few probes are
 *    classified legacy and must still be answered.
 *  - Plain `node:http` has no middleware chain, so DNS-rebinding protection is
 *    wired by hand with `localhostHostValidation()` / `localhostOriginValidation()`
 *    from `@modelcontextprotocol/node`; each guard answers the request itself
 *    and returns false when the caller must stop.
 *  - Cache hints (SEP-2549) are declared once through `ServerOptions.cacheHints`
 *    rather than by wrapping `setRequestHandler` as the v1 reference does.
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import {
  McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
  acceptedContent,
  completable,
  createMcpHandler,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  type CallToolResult,
  type GetPromptResult,
  type InputRequiredResult,
  type InputRequests,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';

const PORT = Number(process.env['PORT'] ?? 3000);
const INSTRUMENT = process.env['MCP_OTEL_INSTRUMENT'] === '1';

/* --------------------------------------------------------------- telemetry */

// The bare server must not pull a single OpenTelemetry module in, so the
// telemetry bootstrap is imported dynamically and only when asked for.
type TelemetryHandle = Awaited<ReturnType<typeof loadTelemetry>>;

async function loadTelemetry() {
  const { startTelemetry } = await import('../telemetry.js');
  return startTelemetry('mcp-example-http-server');
}

let telemetry: TelemetryHandle | undefined;
let instrumentServer: (<T extends { connect(transport: never): unknown }>(server: T, options: unknown) => T) | undefined;

/* ------------------------------------------------------------------ assets */

/** 1x1 red pixel PNG, byte-for-byte the conformance reference fixture. */
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
/** Minimal WAV file, byte-for-byte the conformance reference fixture. */
const TEST_AUDIO_BASE64 = 'UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAA=';

/**
 * HMAC key for the multi-round-trip `requestState`. Random per process: the
 * suite runs every round of a flow against this one process, which is exactly
 * the condition `createRequestStateCodec` documents for a per-process key.
 */
const REQUEST_STATE_KEY = randomBytes(32);

interface MrtrState {
  tool: string;
  round: number;
  name?: string;
}

const requestStateCodec = createRequestStateCodec<MrtrState>({ key: REQUEST_STATE_KEY, ttlSeconds: 600 });

const CACHE_HINT = { ttlMs: 300_000, cacheScope: 'public' as const };

/* ------------------------------------------------------------------ helpers */

function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

/** Client capabilities as declared in the per-request `_meta` envelope. */
function clientCapabilities(ctx: ServerContext): Record<string, unknown> {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const declared = envelope?.['io.modelcontextprotocol/clientCapabilities'];
  return declared !== null && typeof declared === 'object' ? (declared as Record<string, unknown>) : {};
}

const NAME_SCHEMA = { type: 'object' as const, properties: { name: { type: 'string' as const } }, required: ['name'] };
const OK_SCHEMA = { type: 'object' as const, properties: { ok: { type: 'boolean' as const } }, required: ['ok'] };
const COLOR_SCHEMA = { type: 'object' as const, properties: { color: { type: 'string' as const } }, required: ['color'] };
const CONTEXT_SCHEMA = { type: 'object' as const, properties: { context: { type: 'string' as const } }, required: ['context'] };

/* ------------------------------------------------------------------ factory */

export function createConformanceServer(): McpServer {
  const server = new McpServer(
    { name: 'mcp-otel-conformance-server', version: '0.1.0' },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: true },
        logging: {},
        completions: {},
      },
      // SEP-2549: one declaration instead of the v1 reference's handler wrapping.
      cacheHints: {
        'tools/list': CACHE_HINT,
        'prompts/list': CACHE_HINT,
        'resources/list': CACHE_HINT,
        'resources/templates/list': CACHE_HINT,
        'resources/read': CACHE_HINT,
        'server/discover': CACHE_HINT,
      },
      // Integrity-protects the multi-round-trip requestState and rejects a
      // tampered one with the frozen -32602 the suite expects.
      requestState: { verify: requestStateCodec.verify },
    },
  );

  /* ------------------------------------------------------------------ tools */

  server.registerTool('test_simple_text', { description: 'Tests simple text content response' }, async () =>
    text('This is a simple text response for testing.'),
  );

  server.registerTool('test_image_content', { description: 'Tests image content response' }, async () => ({
    content: [{ type: 'image', data: TEST_IMAGE_BASE64, mimeType: 'image/png' }],
  }));

  server.registerTool('test_audio_content', { description: 'Tests audio content response' }, async () => ({
    content: [{ type: 'audio', data: TEST_AUDIO_BASE64, mimeType: 'audio/wav' }],
  }));

  server.registerTool('test_embedded_resource', { description: 'Tests embedded resource content response' }, async () => ({
    content: [
      {
        type: 'resource',
        resource: { uri: 'test://embedded-resource', mimeType: 'text/plain', text: 'This is an embedded resource content.' },
      },
    ],
  }));

  server.registerTool(
    'test_multiple_content_types',
    { description: 'Tests response with multiple content types (text, image, resource)' },
    async () => ({
      content: [
        { type: 'text', text: 'Multiple content types test:' },
        { type: 'image', data: TEST_IMAGE_BASE64, mimeType: 'image/png' },
        {
          type: 'resource',
          resource: { uri: 'test://mixed-content-resource', mimeType: 'application/json', text: JSON.stringify({ test: 'data', value: 123 }) },
        },
      ],
    }),
  );

  server.registerTool('test_tool_with_logging', { description: 'Tests tool that emits log messages during execution' }, async (ctx) => {
    await ctx.mcpReq.log('info', 'Tool execution started');
    await new Promise((r) => setTimeout(r, 50));
    await ctx.mcpReq.log('info', 'Tool processing data');
    await new Promise((r) => setTimeout(r, 50));
    await ctx.mcpReq.log('info', 'Tool execution completed');
    return text('Tool with logging executed successfully');
  });
  // `test_logging_tool` is the name the stateless scenario uses for the same behaviour.
  server.registerTool('test_logging_tool', { description: 'Tests tool that emits log messages during execution' }, async (ctx) => {
    await ctx.mcpReq.log('info', 'Tool execution started');
    await ctx.mcpReq.log('info', 'Tool execution completed');
    return text('Tool with logging executed successfully');
  });

  server.registerTool('test_tool_with_progress', { description: 'Tests tool that reports progress notifications' }, async (ctx) => {
    const progressToken = ctx.mcpReq._meta?.['progressToken'] ?? 0;
    for (const progress of [0, 50, 100]) {
      await ctx.mcpReq.notify({
        method: 'notifications/progress',
        params: { progressToken, progress, total: 100, message: `Completed step ${progress} of 100` },
      });
      if (progress < 100) await new Promise((r) => setTimeout(r, 50));
    }
    return text(String(progressToken));
  });

  server.registerTool('test_error_handling', { description: 'Tests error response handling' }, async () => {
    throw new Error('This tool intentionally returns an error for testing');
  });

  // SEP-2575: needs a client capability the caller did not declare. An error
  // thrown from a tool callback is turned into an `isError` result by the SDK,
  // never into a JSON-RPC error, so the -32021 has to come from the
  // input-required seam: it gates every embedded request against the
  // capabilities the request's own `_meta` envelope declares.
  server.registerTool('test_missing_capability', { description: 'Requires a client capability that must be declared explicitly' }, async (ctx) => {
    if (clientCapabilities(ctx)['sampling'] !== undefined) return text('capability present');
    return inputRequired({
      inputRequests: {
        needs_sampling: inputRequired.createMessage({
          messages: [{ role: 'user', content: { type: 'text', text: 'Requires the sampling capability' } }],
          maxTokens: 10,
        }),
      },
    });
  });

  // SEP-2575 diagnostic: the response stream must carry only incomplete
  // results, never independent JSON-RPC requests. The probe declares the
  // elicitation capability, so the embedded request passes the seam's gate.
  server.registerTool('test_streaming_elicitation', { description: 'Streams an embedded elicitation request' }, async (ctx) => {
    const answer = acceptedContent<{ name?: string }>(ctx.mcpReq.inputResponses, 'stream_name');
    if (answer?.name === undefined) {
      return inputRequired({
        inputRequests: { stream_name: inputRequired.elicit({ message: 'What is your name?', requestedSchema: NAME_SCHEMA }) },
      });
    }
    return text(`Hello, ${answer.name}!`);
  });

  /* --------------------------------------------- multi-round-trip tools (SEP-2322) */

  server.registerTool('test_input_required_result_elicitation', { description: 'Multi-round-trip elicitation flow' }, async (ctx) => {
    const answer = acceptedContent<{ name?: string }>(ctx.mcpReq.inputResponses, 'user_name');
    if (answer?.name === undefined || typeof answer.name !== 'string') {
      return inputRequired({
        inputRequests: {
          user_name: inputRequired.elicit({ message: 'What is your name?', requestedSchema: NAME_SCHEMA }),
        },
      });
    }
    return text(`Hello, ${answer.name}!`);
  });

  server.registerTool('test_input_required_result_sampling', { description: 'Multi-round-trip sampling flow' }, async (ctx) => {
    const view = inputResponse(ctx.mcpReq.inputResponses, 'capital_question');
    if (view.kind !== 'sampling') {
      return inputRequired({
        inputRequests: {
          capital_question: inputRequired.createMessage({
            messages: [{ role: 'user', content: { type: 'text', text: 'What is the capital of France?' } }],
            maxTokens: 100,
          }),
        },
      });
    }
    const content = view.result.content;
    const sampled = Array.isArray(content) ? JSON.stringify(content) : content.type === 'text' ? content.text : JSON.stringify(content);
    return text(`Sampled: ${sampled}`);
  });

  server.registerTool('test_input_required_result_list_roots', { description: 'Multi-round-trip roots/list flow' }, async (ctx) => {
    const view = inputResponse(ctx.mcpReq.inputResponses, 'client_roots');
    if (view.kind !== 'roots') {
      return inputRequired({ inputRequests: { client_roots: inputRequired.listRoots() } });
    }
    return text(`Roots: ${view.roots.map((r) => r.uri).join(', ')}`);
  });

  server.registerTool('test_input_required_result_request_state', { description: 'Multi-round-trip flow carrying requestState' }, async (ctx) => {
    const state = ctx.mcpReq.requestState<MrtrState>();
    const answer = acceptedContent<{ ok?: boolean }>(ctx.mcpReq.inputResponses, 'confirm');
    if (state === undefined || answer === undefined) {
      return inputRequired({
        inputRequests: { confirm: inputRequired.elicit({ message: 'Please confirm', requestedSchema: OK_SCHEMA }) },
        requestState: await requestStateCodec.mint({ tool: 'request_state', round: 1 }),
      });
    }
    return text(`state-ok round ${state.round}`);
  });

  server.registerTool('test_input_required_result_multiple_inputs', { description: 'Multi-round-trip flow with several input requests' }, async (ctx) => {
    const name = acceptedContent<{ name?: string }>(ctx.mcpReq.inputResponses, 'user_name');
    const greeting = inputResponse(ctx.mcpReq.inputResponses, 'greeting');
    const roots = inputResponse(ctx.mcpReq.inputResponses, 'client_roots');
    if (name === undefined || greeting.kind !== 'sampling' || roots.kind !== 'roots') {
      return inputRequired({
        inputRequests: {
          user_name: inputRequired.elicit({ message: 'What is your name?', requestedSchema: NAME_SCHEMA }),
          greeting: inputRequired.createMessage({
            messages: [{ role: 'user', content: { type: 'text', text: 'Generate a greeting' } }],
            maxTokens: 50,
          }),
          client_roots: inputRequired.listRoots(),
        },
        requestState: await requestStateCodec.mint({ tool: 'multiple_inputs', round: 1 }),
      });
    }
    return text(`All inputs received for ${String(name.name ?? 'unknown')}`);
  });

  server.registerTool('test_input_required_result_multi_round', { description: 'Multi-round-trip flow over three rounds' }, async (ctx) => {
    const state = ctx.mcpReq.requestState<MrtrState>();
    const step1 = acceptedContent<{ name?: string }>(ctx.mcpReq.inputResponses, 'step1');
    const step2 = acceptedContent<{ color?: string }>(ctx.mcpReq.inputResponses, 'step2');
    if (state === undefined || (step1 === undefined && step2 === undefined)) {
      return inputRequired({
        inputRequests: { step1: inputRequired.elicit({ message: 'Step 1: What is your name?', requestedSchema: NAME_SCHEMA }) },
        requestState: await requestStateCodec.mint({ tool: 'multi_round', round: 1 }),
      });
    }
    if (step2 === undefined) {
      const minted: MrtrState = { tool: 'multi_round', round: 2 };
      if (typeof step1?.name === 'string') minted.name = step1.name;
      return inputRequired({
        inputRequests: { step2: inputRequired.elicit({ message: 'Step 2: What is your favorite color?', requestedSchema: COLOR_SCHEMA }) },
        requestState: await requestStateCodec.mint(minted),
      });
    }
    return text(`Done: ${String(state.name ?? 'unknown')} likes ${String(step2.color ?? 'unknown')}`);
  });

  server.registerTool('test_input_required_result_tampered_state', { description: 'Multi-round-trip flow with integrity-protected state' }, async (ctx) => {
    const state = ctx.mcpReq.requestState<MrtrState>();
    if (state === undefined) {
      return inputRequired({
        inputRequests: { confirm: inputRequired.elicit({ message: 'Please confirm', requestedSchema: OK_SCHEMA }) },
        requestState: await requestStateCodec.mint({ tool: 'tampered_state', round: 1 }),
      });
    }
    // A tampered value never reaches here: the requestState.verify hook above
    // rejects it with the frozen -32602 the scenario expects.
    return text('state-ok');
  });

  server.registerTool('test_input_required_result_capabilities', { description: 'Only requests inputs the client declared support for' }, async (ctx) => {
    const caps = clientCapabilities(ctx);
    const responses = ctx.mcpReq.inputResponses ?? {};
    if (Object.keys(responses).length > 0) return text('capability-scoped inputs received');
    const requests: InputRequests = {};
    if (caps['elicitation'] !== undefined) {
      requests['user_name'] = inputRequired.elicit({ message: 'What is your name?', requestedSchema: NAME_SCHEMA });
    }
    if (caps['sampling'] !== undefined) {
      requests['greeting'] = inputRequired.createMessage({
        messages: [{ role: 'user', content: { type: 'text', text: 'Generate a greeting' } }],
        maxTokens: 50,
      });
    }
    if (caps['roots'] !== undefined) requests['client_roots'] = inputRequired.listRoots();
    if (Object.keys(requests).length === 0) return text('no declared client capability to request input from');
    return inputRequired({ inputRequests: requests });
  });

  /* -------------------------------------------------------------- resources */

  server.registerResource(
    'static-text',
    'test://static-text',
    { title: 'Static Text Resource', description: 'A static text resource for testing', mimeType: 'text/plain', cacheHint: CACHE_HINT },
    async () => ({
      contents: [{ uri: 'test://static-text', mimeType: 'text/plain', text: 'This is the content of the static text resource.' }],
    }),
  );

  server.registerResource(
    'static-binary',
    'test://static-binary',
    { title: 'Static Binary Resource', description: 'A static binary resource (image) for testing', mimeType: 'image/png', cacheHint: CACHE_HINT },
    async () => ({ contents: [{ uri: 'test://static-binary', mimeType: 'image/png', blob: TEST_IMAGE_BASE64 }] }),
  );

  server.registerResource(
    'watched-resource',
    'test://watched-resource',
    { title: 'Watched Resource', description: 'A resource clients may subscribe to', mimeType: 'text/plain', cacheHint: CACHE_HINT },
    async () => ({ contents: [{ uri: 'test://watched-resource', mimeType: 'text/plain', text: 'Watched resource content' }] }),
  );

  server.registerResource(
    'template',
    new ResourceTemplate('test://template/{id}/data', { list: undefined }),
    { title: 'Resource Template', description: 'A resource template with parameter substitution', mimeType: 'application/json', cacheHint: CACHE_HINT },
    async (uri, variables) => {
      const id = variables['id'];
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify({ id, templateTest: true, data: `Data for ID: ${String(id)}` }),
          },
        ],
      };
    },
  );

  // SEP-2164: an unknown URI must be a -32602 error carrying the uri, never an
  // empty contents array. The template above matches only test://template/...,
  // so anything else lands here.
  server.registerResource(
    'not-found',
    new ResourceTemplate('test://{path*}', { list: undefined }),
    { title: 'Unknown resource', description: 'Answers unknown test:// URIs with a resource-not-found error' },
    async (uri) => {
      throw new ResourceNotFoundError(uri.toString(), 'Resource not found');
    },
  );

  /* ---------------------------------------------------------------- prompts */

  server.registerPrompt('test_simple_prompt', { title: 'Simple Test Prompt', description: 'A simple prompt without arguments' }, async () => ({
    messages: [{ role: 'user', content: { type: 'text', text: 'This is a simple prompt for testing.' } }],
  }));

  server.registerPrompt(
    'test_prompt_with_arguments',
    {
      title: 'Prompt With Arguments',
      description: 'A prompt with required arguments',
      // `completion/complete` is only wired by McpServer when at least one
      // registered argument is completable; declaring the `completions`
      // capability alone leaves the method answering -32601.
      argsSchema: z.object({
        arg1: completable(z.string().describe('First test argument'), (value) => ['paris', 'park', 'party'].filter((v) => v.startsWith(value))),
        arg2: completable(z.string().describe('Second test argument'), (value) => ['alpha', 'beta', 'gamma'].filter((v) => v.startsWith(value))),
      }),
    },
    async ({ arg1, arg2 }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: `Prompt with arguments: arg1='${arg1}', arg2='${arg2}'` } }],
    }),
  );

  server.registerPrompt(
    'test_prompt_with_embedded_resource',
    {
      title: 'Prompt With Embedded Resource',
      description: 'A prompt that includes an embedded resource',
      argsSchema: z.object({ resourceUri: z.string().describe('URI of the resource to embed') }),
    },
    async ({ resourceUri }) => ({
      messages: [
        { role: 'user', content: { type: 'resource', resource: { uri: resourceUri, mimeType: 'text/plain', text: 'Embedded resource content for testing.' } } },
        { role: 'user', content: { type: 'text', text: 'Please process the embedded resource above.' } },
      ],
    }),
  );

  server.registerPrompt('test_prompt_with_image', { title: 'Prompt With Image', description: 'A prompt that includes image content' }, async () => ({
    messages: [
      { role: 'user', content: { type: 'image', data: TEST_IMAGE_BASE64, mimeType: 'image/png' } },
      { role: 'user', content: { type: 'text', text: 'Please analyze the image above.' } },
    ],
  }));

  // SEP-2322: input_required is universal, so a prompt exercises it too.
  server.registerPrompt(
    'test_input_required_result_prompt',
    {
      title: 'Prompt Requiring Input',
      description: 'A prompt that requires elicitation input before it can be built',
    },
    // SDK 2.0.0 quirk: registerPrompt's `Args` generic has no `undefined`
    // default, so a config without argsSchema still types the callback as
    // (args, ctx) while the runtime calls it with (ctx) alone. Declaring an
    // empty zod object instead would reject a `prompts/get` that omits
    // `arguments`, which is exactly what the scenario sends, so the callback
    // is written to the runtime shape and cast past the overload.
    (async (ctx: ServerContext): Promise<GetPromptResult | InputRequiredResult> => {
      const answer = acceptedContent<{ context?: string }>(ctx.mcpReq.inputResponses, 'user_context');
      if (answer?.context === undefined) {
        return inputRequired({
          inputRequests: { user_context: inputRequired.elicit({ message: 'What context should the prompt use?', requestedSchema: CONTEXT_SCHEMA }) },
        });
      }
      return { messages: [{ role: 'user', content: { type: 'text', text: `Context: ${answer.context}` } }] };
    }) as never,
  );

  if (INSTRUMENT && instrumentServer !== undefined && telemetry !== undefined) {
    // createMcpHandler owns the transport, so `connect` is the only seam.
    instrumentServer(server as never, { tracerProvider: telemetry.provider, networkTransport: 'tcp', serverAddress: 'localhost', serverPort: PORT });
  }

  return server;
}

/* --------------------------------------------------------------------- wire */

async function main(): Promise<void> {
  if (INSTRUMENT) {
    telemetry = await loadTelemetry();
    const mod = await import('../../src/index.js');
    instrumentServer = mod.instrumentServer as typeof instrumentServer;
  }

  const handler = createMcpHandler(() => createConformanceServer(), {
    legacy: 'stateless',
    onerror: (error) => process.stderr.write(`handler error: ${error.message}\n`),
  });
  const nodeHandler = toNodeHandler(handler, { onerror: (error) => process.stderr.write(`adapter error: ${error.message}\n`) });

  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const httpServer = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    // No middleware chain in node:http: each guard answers the request itself
    // and returns false when we must not handle it further.
    if (!validateHost(req, res)) return;
    if (!validateOrigin(req, res)) return;
    // `exactOptionalPropertyTypes` makes IncomingMessage's optional `method`/`url`
    // incompatible with the adapter's duck-typed shape; the values are present here.
    void nodeHandler(req as unknown as Parameters<typeof nodeHandler>[0], res);
  });

  httpServer.listen(PORT, () => {
    process.stderr.write(`listening on http://localhost:${PORT}/mcp\n`);
  });

  const shutdown = async (): Promise<void> => {
    httpServer.close();
    await handler.close();
    if (telemetry !== undefined) await telemetry.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void main();
