import { context, propagation, trace, SpanKind, SpanStatusCode, type Attributes, type Context, type Span, type Tracer } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BasicTracerProvider, BatchSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-base';

export interface TracingOptions {
  /** Runtime name, e.g. api, worker, edge; becomes service.name `rifad-<runtime>`. */
  readonly runtime: string;
  /** Optional OTLP/HTTP traces endpoint (local collector). Without it spans and IDs exist but nothing is exported. */
  readonly exporterUrl?: string;
  /** Test seam: extra processors, e.g. an in-memory exporter. */
  readonly processors?: readonly SpanProcessor[];
}

export interface Tracing {
  readonly tracer: Tracer;
  shutdown(): Promise<void>;
}

const tracerName = '@rifad/observability';

/**
 * OpenTelemetry baseline (M0-024): W3C trace context, async-local context and an optional OTLP/HTTP
 * exporter. The backend provider is not chosen (G16), so exporting is opt-in and local only.
 * Call once per process before the HTTP app is created.
 */
export function initTracing(options: TracingOptions): Tracing {
  const processors: SpanProcessor[] = [...(options.processors ?? [])];
  if (options.exporterUrl) processors.push(new BatchSpanProcessor(new OTLPTraceExporter({ url: options.exporterUrl, timeoutMillis: 5_000 })));
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'service.name': `rifad-${options.runtime}`, 'service.namespace': 'rifad' }),
    spanProcessors: processors,
  });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
  return Object.freeze({
    tracer: trace.getTracer(tracerName),
    shutdown: async () => {
      await provider.shutdown().catch(() => undefined);
      trace.disable();
      propagation.disable();
      context.disable();
    },
  });
}

export function tracer(): Tracer {
  return trace.getTracer(tracerName);
}

/** Runs `work` in a new active span; records failures by error name only (no messages or values). */
export async function withSpan<T>(name: string, attributes: Attributes, work: (span: Span) => Promise<T>, parent?: Context): Promise<T> {
  const span = tracer().startSpan(name, { attributes, kind: SpanKind.INTERNAL }, parent ?? context.active());
  try {
    return await context.with(trace.setSpan(parent ?? context.active(), span), () => work(span));
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.name : 'Error' });
    throw error;
  } finally {
    span.end();
  }
}

/** IDs of the active span for log correlation, or undefined outside a span. */
export function activeTraceIds(): { traceId: string; spanId: string } | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  return spanContext && trace.isSpanContextValid(spanContext) ? { traceId: spanContext.traceId, spanId: spanContext.spanId } : undefined;
}

const traceparentPattern = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

/** W3C `traceparent` of the active span, for storing with durable work (e.g. outbox rows). */
export function currentTraceparent(): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const value = carrier['traceparent'];
  return value && traceparentPattern.test(value) ? value : undefined;
}

/** Context carrying a stored/received `traceparent`; malformed values are ignored, never trusted. */
export function contextFromTraceparent(traceparent: string | null | undefined, base: Context = context.active()): Context {
  if (!traceparent || !traceparentPattern.test(traceparent)) return base;
  return propagation.extract(base, { traceparent });
}

export { SpanKind, SpanStatusCode, context as otelContext, trace as otelTrace };
export type { Context, Span };
