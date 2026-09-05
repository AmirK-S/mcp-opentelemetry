/**
 * OpenTelemetry bootstrap shared by the examples.
 *
 * Spans go to an OTLP/HTTP endpoint (Jaeger by default, port 4318) and,
 * when MCP_OTEL_STDERR_SPANS=1, to stderr as JSON lines. The stdio server
 * must never write to stdout: that is the MCP wire.
 */
import { propagation, type Context, type TextMapPropagator } from '@opentelemetry/api';
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator, hrTimeToNanoseconds, type ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, SimpleSpanProcessor, type ReadableSpan, type SpanExporter, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/** Writes one JSON object per finished span on stderr. Used by the integration tests. */
export class StderrJsonLinesExporter implements SpanExporter {
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    for (const span of spans) {
      process.stderr.write(
        JSON.stringify({
          name: span.name,
          kind: span.kind,
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          parentSpanId: span.parentSpanContext?.spanId,
          links: span.links.map((l) => ({ traceId: l.context.traceId, spanId: l.context.spanId })),
          attributes: span.attributes,
          status: span.status,
          startNs: hrTimeToNanoseconds(span.startTime),
          endNs: hrTimeToNanoseconds(span.endTime),
          service: span.resource.attributes[ATTR_SERVICE_NAME],
        }) + '\n',
      );
    }
    resultCallback({ code: ExportResultCode.SUCCESS });
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export interface Telemetry {
  provider: NodeTracerProvider;
  propagator: TextMapPropagator<Context>;
  shutdown(): Promise<void>;
}

export function startTelemetry(serviceName: string): Telemetry {
  const processors: SpanProcessor[] = [];
  if (process.env['MCP_OTEL_NO_OTLP'] !== '1') {
    processors.push(new BatchSpanProcessor(new OTLPTraceExporter(), { scheduledDelayMillis: 200 }));
  }
  if (process.env['MCP_OTEL_STDERR_SPANS'] === '1') {
    processors.push(new SimpleSpanProcessor(new StderrJsonLinesExporter()));
  }
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    spanProcessors: processors,
  });
  const propagator = new CompositePropagator({ propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()] });
  // register() installs the AsyncLocalStorage context manager and the propagator globally.
  provider.register({ propagator });
  propagation.setGlobalPropagator(propagator);
  return { provider, propagator, shutdown: () => provider.shutdown() };
}
