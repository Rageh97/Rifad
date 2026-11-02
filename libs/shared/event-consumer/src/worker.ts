import { Worker, type Job } from 'bullmq';
import type { Kysely } from 'kysely';
import { validateEnvelope, type EventEnvelope } from '@rifad/events';
import { SpanKind, SpanStatusCode, otelContext, otelTrace, tracer } from '@rifad/observability';
import { CLOUD_EVENTS_QUEUE, connectionOptions, type QueueConnection } from '@rifad/queue';
import { createRequestContext, runWithContext, type RequestContext } from '@rifad/request-context';
import { consumeEvent, type ConsumeOutcome, type EventHandler } from './consume';

/** Execution context for one event: its correlation ID and tenant/branch scope, with a fresh request ID. */
export function eventContext(envelope: EventEnvelope): RequestContext {
  return createRequestContext({
    correlationId: envelope.correlationId, organizationId: envelope.organizationId,
    ...(envelope.branchId ? { branchId: envelope.branchId } : {}),
  });
}

/** One named consumer and the event types it handles. Names are stable: they key durable state. */
export interface ConsumerRegistration<DB> {
  readonly name: string;
  readonly eventTypes: readonly string[];
  readonly handler: EventHandler<DB>;
}

export interface EventConsumerOptions<DB> {
  readonly connection: QueueConnection;
  readonly db: Kysely<DB>;
  readonly consumers: readonly ConsumerRegistration<DB>[];
  readonly concurrency?: number;
  readonly onResult?: (result: { eventType: string; consumer: string; outcome: ConsumeOutcome }) => void;
  readonly onError?: (error: unknown) => void;
}

export interface EventConsumerHandle {
  close(): Promise<void>;
}

/**
 * BullMQ worker for `rifad-cloud-events` that fans each event out to its registered consumers via
 * `consumeEvent`. A thrown handler error or ordering gap fails the job, so BullMQ's retry/backoff
 * redelivers it; durable state makes every redelivery idempotent. Events with no consumer are
 * acknowledged. Registration fails fast on duplicate consumer names.
 */
export function startEventConsumer<DB>(options: EventConsumerOptions<DB>): EventConsumerHandle {
  const names = options.consumers.map(consumer => consumer.name);
  if (new Set(names).size !== names.length) throw new TypeError('Duplicate consumer name');
  const byType = new Map<string, ConsumerRegistration<DB>[]>();
  for (const consumer of options.consumers) {
    for (const eventType of consumer.eventTypes) byType.set(eventType, [...(byType.get(eventType) ?? []), consumer]);
  }
  const worker = new Worker(CLOUD_EVENTS_QUEUE, async (job: Job) => {
    const envelope: EventEnvelope = validateEnvelope(job.data as EventEnvelope);
    // The originating request's correlation ID and tenant follow the event into the worker (M0-005), so
    // handler logs join the same trail. The tenant comes from an RLS-checked outbox row, not a caller.
    await runWithContext(eventContext(envelope), async () => {
      for (const consumer of byType.get(envelope.eventType) ?? []) {
        const span = tracer().startSpan('event consume', {
          kind: SpanKind.CONSUMER,
          attributes: { 'messaging.system': 'bullmq', 'messaging.operation.name': 'process', 'rifad.consumer': consumer.name, 'rifad.event_type': envelope.eventType },
        });
        try {
          const outcome = await otelContext.with(otelTrace.setSpan(otelContext.active(), span), () => consumeEvent(options.db, consumer.name, envelope, consumer.handler));
          options.onResult?.({ eventType: envelope.eventType, consumer: consumer.name, outcome });
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.name : 'Error' });
          throw error;
        } finally {
          span.end();
        }
      }
    });
  }, { connection: connectionOptions(options.connection), concurrency: options.concurrency ?? 4, autorun: true });
  worker.on('error', error => options.onError?.(error));
  worker.on('failed', (_job, error) => options.onError?.(error));
  return Object.freeze({ close: () => worker.close() });
}
