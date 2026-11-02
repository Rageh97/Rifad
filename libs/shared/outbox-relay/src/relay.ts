import { sql, type Kysely } from 'kysely';
import type { Queue } from 'bullmq';
import { EnvelopeError, validateEnvelope, type EventEnvelope } from '@rifad/events';
import { SpanKind, SpanStatusCode, contextFromTraceparent, tracer } from '@rifad/observability';

export interface RelayOptions {
  readonly batchSize?: number;
  /** After this many failed publish attempts the row becomes FAILED and needs operator action. */
  readonly maxAttempts?: number;
  readonly retryBaseMs?: number;
  readonly publishTimeoutMs?: number;
  /** Test seam: runs after a successful publish and before the row is marked; throwing simulates a crash. */
  readonly afterPublish?: (eventId: string) => Promise<void> | void;
}

export interface RelayResult {
  readonly claimed: number;
  readonly published: number;
  readonly retried: number;
  readonly failed: number;
}

interface OutboxRow {
  event_id: string; organization_id: string; branch_id: string | null; event_type: string; event_version: number;
  plane: EventEnvelope['plane']; ordering: EventEnvelope['ordering']; aggregate_type: string; aggregate_id: string;
  aggregate_version: string; occurred_at: Date; correlation_id: string; causation_id: string | null; idempotency_key: string;
  payload: unknown; attempts: number; trace_parent: string | null;
}

function toEnvelope(row: OutboxRow): EventEnvelope {
  return validateEnvelope({
    eventId: row.event_id, eventType: row.event_type, eventVersion: row.event_version, plane: row.plane, ordering: row.ordering,
    organizationId: row.organization_id, branchId: row.branch_id, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id,
    aggregateVersion: Number(row.aggregate_version), occurredAt: new Date(row.occurred_at).toISOString(), correlationId: row.correlation_id,
    causationId: row.causation_id, idempotencyKey: row.idempotency_key, payload: row.payload,
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  promise.catch(() => undefined);
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PUBLISH_TIMEOUT')), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

/**
 * One relay pass (M0-021): claims due PENDING rows with `FOR UPDATE SKIP LOCKED` (so concurrent
 * relays never double-claim), publishes each to BullMQ with jobId = eventId, and marks it PUBLISHED
 * in the same transaction. A crash after publishing but before commit leaves the row PENDING; the
 * retry reuses the jobId, which BullMQ deduplicates, so no pending event is lost or duplicated.
 * Runs as the scoped relay role; Edge events never enter this outbox (ADR-041).
 */
export async function relayOnce<DB>(db: Kysely<DB>, queue: Queue, options: RelayOptions = {}): Promise<RelayResult> {
  const batchSize = options.batchSize ?? 50;
  const maxAttempts = options.maxAttempts ?? 10;
  const retryBaseMs = options.retryBaseMs ?? 1_000;
  const publishTimeoutMs = options.publishTimeoutMs ?? 5_000;
  return db.transaction().execute(async trx => {
    const rows = (await sql<OutboxRow>`
      select event_id, organization_id, branch_id, event_type, event_version, plane, ordering, aggregate_type, aggregate_id,
             aggregate_version, occurred_at, correlation_id, causation_id, idempotency_key, payload, attempts, trace_parent
      from events.outbox where status = 'PENDING' and available_at <= now()
      order by recorded_at, event_id limit ${batchSize} for update skip locked`.execute(trx)).rows;
    let published = 0, retried = 0, failed = 0;
    for (const row of rows) {
      let envelope: EventEnvelope;
      try { envelope = toEnvelope(row); }
      catch (error) {
        if (!(error instanceof EnvelopeError)) throw error;
        // A row that cannot form a valid envelope is poison: stop retrying and surface it.
        await sql`update events.outbox set status = 'FAILED', attempts = attempts + 1, last_error = 'INVALID_ENVELOPE' where event_id = ${row.event_id}`.execute(trx);
        failed++;
        continue;
      }
      // The publish span continues the writer's trace stored with the row (API -> DB -> worker, M0-024).
      const span = tracer().startSpan('outbox publish', {
        kind: SpanKind.PRODUCER,
        attributes: { 'messaging.system': 'bullmq', 'messaging.operation.name': 'publish', 'rifad.event_type': envelope.eventType, 'rifad.aggregate_type': envelope.aggregateType },
      }, contextFromTraceparent(row.trace_parent));
      try {
        await withTimeout(queue.add(envelope.eventType, envelope, { jobId: envelope.eventId }), publishTimeoutMs);
        span.end();
      } catch {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'QUEUE_UNAVAILABLE' });
        span.end();
        const attempts = row.attempts + 1;
        const delayMs = Math.min(retryBaseMs * 2 ** (attempts - 1), 15 * 60_000);
        const status = attempts >= maxAttempts ? 'FAILED' : 'PENDING';
        await sql`update events.outbox set attempts = ${attempts}, status = ${status}, last_error = 'QUEUE_UNAVAILABLE',
          available_at = now() + make_interval(secs => ${delayMs / 1000}) where event_id = ${row.event_id}`.execute(trx);
        if (status === 'FAILED') failed++; else retried++;
        // The queue is down: stop this pass instead of timing out on every remaining row.
        break;
      }
      await options.afterPublish?.(envelope.eventId);
      await sql`update events.outbox set status = 'PUBLISHED', published_at = now(), attempts = attempts + 1, last_error = null
        where event_id = ${row.event_id}`.execute(trx);
      published++;
    }
    return { claimed: rows.length, published, retried, failed };
  });
}

export interface RelayHandle {
  stop(): Promise<void>;
}

/**
 * Polling loop around `relayOnce`. A full batch triggers an immediate next pass; errors are reported
 * and retried on the next interval. `stop` waits for the in-flight pass to finish.
 */
export function startRelay<DB>(db: Kysely<DB>, queue: Queue, options: RelayOptions & {
  readonly intervalMs?: number;
  readonly onResult?: (result: RelayResult) => void;
  readonly onError?: (error: unknown) => void;
} = {}): RelayHandle {
  const intervalMs = options.intervalMs ?? 500;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> = Promise.resolve();
  const schedule = (delay: number) => { if (!stopped) timer = setTimeout(() => { current = tick(); }, delay); };
  const tick = async () => {
    try {
      const result = await relayOnce(db, queue, options);
      if (result.claimed) options.onResult?.(result);
      schedule(result.published === (options.batchSize ?? 50) ? 0 : intervalMs);
    } catch (error) {
      options.onError?.(error);
      schedule(intervalMs);
    }
  };
  schedule(0);
  return Object.freeze({
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await current;
    },
  });
}
