import { sql, type QueryExecutorProvider } from 'kysely';
import { EnvelopeError, validateEnvelope, type EventEnvelope } from '@rifad/events';
import { currentTraceparent } from '@rifad/observability';

/** Cloud Postgres outbox row (owner: shared events module; migration 0002_events_outbox). */
export interface EventsOutboxTable {
  event_id: string;
  organization_id: string;
  branch_id: string | null;
  event_type: string;
  event_version: number;
  plane: 'CLOUD' | 'CLOUD_TO_EDGE';
  ordering: 'NONE' | 'PER_AGGREGATE' | 'PER_BRANCH';
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: string | number;
  occurred_at: Date | string;
  correlation_id: string;
  causation_id: string | null;
  idempotency_key: string;
  payload: unknown;
}

/** Only Cloud-originated planes enter the Cloud outbox; Edge events use the Edge local outbox (ADR-041). */
const cloudPlanes = new Set(['CLOUD', 'CLOUD_TO_EDGE']);

/**
 * Appends an event inside the caller's transaction so the business change and the event commit
 * or roll back together (§25 Outbox). RLS rejects an envelope for another tenant than the
 * transaction's context.
 */
export async function appendToOutbox(db: QueryExecutorProvider, input: EventEnvelope): Promise<void> {
  const e = validateEnvelope(input);
  if (!cloudPlanes.has(e.plane)) throw new EnvelopeError('plane');
  // The writer's trace context travels with the row so the relay's publish span joins the same trace (M0-024).
  const traceParent = currentTraceparent() ?? null;
  // Explicit parameterized SQL: accepts any Kysely instance or transaction regardless of its schema type.
  await sql`insert into events.outbox (event_id, organization_id, branch_id, event_type, event_version, plane, ordering,
      aggregate_type, aggregate_id, aggregate_version, occurred_at, correlation_id, causation_id, idempotency_key, payload, trace_parent)
    values (${e.eventId}, ${e.organizationId}, ${e.branchId}, ${e.eventType}, ${e.eventVersion}, ${e.plane}, ${e.ordering},
      ${e.aggregateType}, ${e.aggregateId}, ${e.aggregateVersion}, ${e.occurredAt}, ${e.correlationId}, ${e.causationId},
      ${e.idempotencyKey}, ${JSON.stringify(e.payload)}::jsonb, ${traceParent})`.execute(db);
}
