/**
 * Requires Jaeger on localhost (see examples/stdio/client.ts). Runs the
 * example client as a subprocess, then reads the trace back from the Jaeger
 * API and checks that the client span and the server span share one trace
 * with the right parent. The trace is saved under test/integration/results.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = new URL('../../', import.meta.url).pathname;
const JAEGER = process.env['JAEGER_QUERY_URL'] ?? 'http://localhost:16686';

interface JaegerSpan {
  spanID: string;
  operationName: string;
  processID: string;
  references: Array<{ refType: string; spanID: string }>;
  tags: Array<{ key: string; value: unknown }>;
}
interface JaegerTrace {
  traceID: string;
  spans: JaegerSpan[];
  processes: Record<string, { serviceName: string }>;
}

async function jaegerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${JAEGER}/api/services`);
    return res.ok;
  } catch {
    return false;
  }
}

describe('Jaeger end to end', () => {
  it('shows the client span and the server span in one trace', async () => {
    if (!(await jaegerUp())) throw new Error(`Jaeger is not reachable at ${JAEGER}; start it with the docker command of the README`);

    const { stdout } = await run(process.execPath, [`${root}node_modules/tsx/dist/cli.mjs`, `${root}examples/stdio/client.ts`, 'Berlin'], { cwd: root });
    const traceId = /^trace ([0-9a-f]{32})$/m.exec(stdout)?.[1];
    expect(traceId).toBeDefined();

    let trace: JaegerTrace | undefined;
    for (let attempt = 0; attempt < 30 && !trace; attempt++) {
      const res = await fetch(`${JAEGER}/api/traces/${traceId}`);
      if (res.ok) {
        const body = (await res.json()) as { data: JaegerTrace[] };
        const candidate = body.data[0];
        const services = new Set(Object.values(candidate?.processes ?? {}).map((p) => p.serviceName));
        if (candidate && services.has('mcp-example-client') && services.has('mcp-example-server')) trace = candidate;
      }
      if (!trace) await new Promise((r) => setTimeout(r, 1000));
    }
    expect(trace, 'trace with both services not found in Jaeger').toBeDefined();

    mkdirSync(`${root}test/integration/results`, { recursive: true });
    writeFileSync(`${root}test/integration/results/jaeger-trace.json`, JSON.stringify(trace, null, 2));

    const byService = (name: string) => Object.entries(trace!.processes).find(([, p]) => p.serviceName === name)?.[0];
    const clientProcess = byService('mcp-example-client');
    const serverProcess = byService('mcp-example-server');
    const clientSpan = trace!.spans.find((s) => s.operationName === 'tools/call get-weather' && s.processID === clientProcess);
    const serverSpan = trace!.spans.find((s) => s.operationName === 'tools/call get-weather' && s.processID === serverProcess);
    const agent = trace!.spans.find((s) => s.operationName === 'agent');
    const lookup = trace!.spans.find((s) => s.operationName === 'lookup-forecast');
    expect(clientSpan).toBeDefined();
    expect(serverSpan).toBeDefined();
    expect(agent).toBeDefined();
    expect(lookup).toBeDefined();
    expect(clientSpan!.references.find((r) => r.refType === 'CHILD_OF')?.spanID).toBe(agent!.spanID);
    expect(serverSpan!.references.find((r) => r.refType === 'CHILD_OF')?.spanID).toBe(clientSpan!.spanID);
    expect(lookup!.references.find((r) => r.refType === 'CHILD_OF')?.spanID).toBe(serverSpan!.spanID);
    expect(serverSpan!.tags.find((t) => t.key === 'gen_ai.tool.name')?.value).toBe('get-weather');
  });
});
