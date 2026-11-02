import { sql, type Kysely } from 'kysely';

/** Operator view of an event that exhausted its publish attempts; never includes the payload. */
export interface FailedEvent {
  readonly eventId: string;
  readonly organizationId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly recordedAt: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Oldest FAILED outbox rows first, bounded. Runs as the scoped relay role. */
export async function listFailed<DB>(db: Kysely<DB>, limit = 100): Promise<FailedEvent[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new TypeError('limit must be 1..1000');
  const rows = (await sql<{ event_id: string; organization_id: string; event_type: string; aggregate_type: string; attempts: number; last_error: string | null; recorded_at: Date }>`
    select event_id, organization_id, event_type, aggregate_type, attempts, last_error, recorded_at
    from events.outbox where status = 'FAILED' order by recorded_at, event_id limit ${limit}`.execute(db)).rows;
  return rows.map(row => ({
    eventId: row.event_id, organizationId: row.organization_id, eventType: row.event_type, aggregateType: row.aggregate_type,
    attempts: row.attempts, lastError: row.last_error, recordedAt: new Date(row.recorded_at).toISOString(),
  }));
}

export type RetrySelection = { readonly eventIds: readonly string[] } | { readonly allQueueFailures: true };

/**
 * Returns FAILED rows to PENDING with a fresh attempt budget so the relay publishes them again
 * (jobId = eventId keeps the publish idempotent). Explicit event IDs may include any failure;
 * `allQueueFailures` only selects QUEUE_UNAVAILABLE rows, because an INVALID_ENVELOPE row would just
 * fail again and needs a deliberate, per-event decision.
 */
export async function retryFailed<DB>(db: Kysely<DB>, selection: RetrySelection): Promise<string[]> {
  if ('eventIds' in selection) {
    if (!selection.eventIds.length || selection.eventIds.length > 1_000 || !selection.eventIds.every(id => uuid.test(id))) throw new TypeError('eventIds must be 1..1000 UUIDs');
    const rows = (await sql<{ event_id: string }>`
      update events.outbox set status = 'PENDING', attempts = 0, available_at = now(), last_error = null
      where status = 'FAILED' and event_id = any(${[...selection.eventIds]}::uuid[]) returning event_id`.execute(db)).rows;
    return rows.map(row => row.event_id);
  }
  const rows = (await sql<{ event_id: string }>`
    update events.outbox set status = 'PENDING', attempts = 0, available_at = now(), last_error = null
    where status = 'FAILED' and last_error = 'QUEUE_UNAVAILABLE' returning event_id`.execute(db)).rows;
  return rows.map(row => row.event_id);
}
