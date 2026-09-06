/**
 * The four duration histograms of the convention, in seconds, with the
 * explicit bucket boundaries it recommends.
 */
import { SpanStatusCode } from '@opentelemetry/api';
import { AggregationTemporality, DataPointType, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader, type HistogramMetricData } from '@opentelemetry/sdk-metrics';
import { afterEach, describe, expect, it } from 'vitest';
import { instrumentClientTransport, instrumentServerTransport } from '../src/index.js';
import {
  ATTR_ERROR_TYPE,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_JSONRPC_REQUEST_ID,
  ATTR_MCP_METHOD_NAME,
  ATTR_MCP_PROTOCOL_VERSION,
  METRIC_MCP_CLIENT_OPERATION_DURATION,
  METRIC_MCP_CLIENT_SESSION_DURATION,
  METRIC_MCP_SERVER_OPERATION_DURATION,
  METRIC_MCP_SERVER_SESSION_DURATION,
} from '../src/semconv.js';
import { connectedPair, setupOtel, type Pair } from './helpers.js';

const BOUNDARIES = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];

let pair: Pair | undefined;
afterEach(async () => {
  await pair?.close();
  pair = undefined;
});

function setupMetrics() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
  const meterProvider = new MeterProvider({ readers: [reader] });
  const histogram = async (name: string): Promise<HistogramMetricData | undefined> => {
    await reader.forceFlush();
    for (const rm of exporter.getMetrics()) {
      for (const scope of rm.scopeMetrics) {
        for (const m of scope.metrics) {
          if (m.descriptor.name === name && m.dataPointType === DataPointType.HISTOGRAM) return m;
        }
      }
    }
    return undefined;
  };
  return { meterProvider, histogram };
}

describe('operation duration histograms', () => {
  it('record one point per tools/call on each side, in seconds, with the convention buckets', async () => {
    const otel = setupOtel();
    const { meterProvider, histogram } = setupMetrics();
    const options = { ...otel.options, meterProvider };
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, options),
      instrumentServer: (t) => instrumentServerTransport(t, options),
    });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    await new Promise((r) => setImmediate(r));

    for (const name of [METRIC_MCP_CLIENT_OPERATION_DURATION, METRIC_MCP_SERVER_OPERATION_DURATION]) {
      const h = await histogram(name);
      expect(h, name).toBeDefined();
      expect(h!.descriptor.unit).toBe('s');
      const point = h!.dataPoints.find((p) => p.attributes[ATTR_MCP_METHOD_NAME] === 'tools/call');
      expect(point, `${name} point for tools/call`).toBeDefined();
      expect(point!.value.count).toBe(1);
      expect(point!.value.sum).toBeGreaterThan(0);
      expect(point!.value.sum).toBeLessThan(5);
      expect(point!.value.buckets.boundaries).toEqual(BOUNDARIES);
      expect(point!.attributes[ATTR_GEN_AI_TOOL_NAME]).toBe('echo');
      expect(point!.attributes[ATTR_GEN_AI_OPERATION_NAME]).toBe('execute_tool');
      expect(point!.attributes[ATTR_MCP_PROTOCOL_VERSION]).toBe(pair.negotiatedProtocolVersion());
      expect(point!.attributes[ATTR_JSONRPC_REQUEST_ID]).toBeUndefined();
      expect(point!.attributes[ATTR_ERROR_TYPE]).toBeUndefined();
    }
  });

  it('carry error.type on failures, as a separate point', async () => {
    const otel = setupOtel();
    const { meterProvider, histogram } = setupMetrics();
    const options = { ...otel.options, meterProvider };
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, options),
      instrumentServer: (t) => instrumentServerTransport(t, options),
    });
    await pair.client.callTool({ name: 'fail', arguments: {} });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    await new Promise((r) => setImmediate(r));
    const h = (await histogram(METRIC_MCP_CLIENT_OPERATION_DURATION))!;
    const failed = h.dataPoints.find((p) => p.attributes[ATTR_GEN_AI_TOOL_NAME] === 'fail');
    const ok = h.dataPoints.find((p) => p.attributes[ATTR_GEN_AI_TOOL_NAME] === 'echo');
    expect(failed?.attributes[ATTR_ERROR_TYPE]).toBe('tool_error');
    expect(ok?.attributes[ATTR_ERROR_TYPE]).toBeUndefined();
    expect(otel.clientSpans().find((s) => s.name === 'tools/call fail')?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('record notifications too', async () => {
    const otel = setupOtel();
    const { meterProvider, histogram } = setupMetrics();
    const options = { ...otel.options, meterProvider };
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, options),
      instrumentServer: (t) => instrumentServerTransport(t, options),
    });
    await new Promise((r) => setImmediate(r));
    const h = (await histogram(METRIC_MCP_CLIENT_OPERATION_DURATION))!;
    const initialized = h.dataPoints.find((p) => p.attributes[ATTR_MCP_METHOD_NAME] === 'notifications/initialized');
    expect(initialized?.value.count).toBe(1);
  });
});

describe('session duration histograms', () => {
  it('record one point per side when the transport closes', async () => {
    const otel = setupOtel();
    const { meterProvider, histogram } = setupMetrics();
    const options = { ...otel.options, meterProvider };
    pair = await connectedPair({
      instrumentClient: (t) => instrumentClientTransport(t, options),
      instrumentServer: (t) => instrumentServerTransport(t, options),
    });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    expect(await histogram(METRIC_MCP_CLIENT_SESSION_DURATION)).toBeUndefined();
    await pair.close();
    pair = undefined;

    const client = await histogram(METRIC_MCP_CLIENT_SESSION_DURATION);
    const server = await histogram(METRIC_MCP_SERVER_SESSION_DURATION);
    expect(client).toBeDefined();
    expect(server).toBeDefined();
    for (const h of [client!, server!]) {
      expect(h.descriptor.unit).toBe('s');
      expect(h.dataPoints).toHaveLength(1);
      expect(h.dataPoints[0]!.value.count).toBe(1);
      expect(h.dataPoints[0]!.value.buckets.boundaries).toEqual(BOUNDARIES);
      expect(h.dataPoints[0]!.attributes[ATTR_MCP_METHOD_NAME]).toBeUndefined();
    }
  });
});

describe('metrics can be turned off', () => {
  it('records nothing with instrumentMetrics: false', async () => {
    const otel = setupOtel();
    const { meterProvider, histogram } = setupMetrics();
    const options = { ...otel.options, meterProvider, instrumentMetrics: false };
    pair = await connectedPair({ instrumentClient: (t) => instrumentClientTransport(t, options) });
    await pair.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    expect(await histogram(METRIC_MCP_CLIENT_OPERATION_DURATION)).toBeUndefined();
  });
});
