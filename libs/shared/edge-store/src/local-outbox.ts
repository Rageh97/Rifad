import { EnvelopeError, validateEnvelope, type EventEnvelope } from '@rifad/events';
import type { EdgeStore } from './store';

export class EdgeScopeError extends Error {
  constructor() {
    super('EDGE_SCOPE_VIOLATION');
    this.name = 'EdgeScopeError';
  }
}

const edgePlanes = new Set(['EDGE', 'EDGE_TO_CLOUD']);

/**
 * Appends an Edge-originated event to the local outbox. Call it inside the same `db.transaction`
 * as the branch state change, so state and event commit atomically even with no internet (§31.1,
 * ADR-041). Events must belong to this device's tenant and branch; Cloud planes are rejected.
 */
export function appendLocalEvent(store: EdgeStore, input: EventEnvelope): number {
  const e = validateEnvelope(input);
  if (!edgePlanes.has(e.plane)) throw new EnvelopeError('plane');
  if (e.organizationId !== store.identity.organizationId || e.branchId !== store.identity.branchId) throw new EdgeScopeError();
  const result = store.db.prepare(`insert into local_outbox (event_id, organization_id, branch_id, event_type, event_version, plane, ordering,
      aggregate_type, aggregate_id, aggregate_version, occurred_at, correlation_id, causation_id, idempotency_key, payload, recorded_at)
    values (@eventId, @organizationId, @branchId, @eventType, @eventVersion, @plane, @ordering, @aggregateType, @aggregateId,
      @aggregateVersion, @occurredAt, @correlationId, @causationId, @idempotencyKey, @payload, @recordedAt)`).run({
    ...e, payload: JSON.stringify(e.payload), recordedAt: new Date().toISOString(),
  });
  return Number(result.lastInsertRowid);
}

export interface LocalEvent {
  /** Monotonic local sequence; the Edge -> Cloud inbox uses it as `sourceSequence` (M0-022). */
  readonly sequence: number;
  readonly envelope: EventEnvelope;
}

interface Row {
  sequence: number; event_id: string; organization_id: string; branch_id: string; event_type: string; event_version: number;
  plane: EventEnvelope['plane']; ordering: EventEnvelope['ordering']; aggregate_type: string; aggregate_id: string; aggregate_version: number;
  occurred_at: string; correlation_id: string; causation_id: string | null; idempotency_key: string; payload: string;
}

const toLocal = (row: Row): LocalEvent => ({
  sequence: row.sequence,
  envelope: validateEnvelope({
    eventId: row.event_id, eventType: row.event_type, eventVersion: row.event_version, plane: row.plane, ordering: row.ordering,
    organizationId: row.organization_id, branchId: row.branch_id, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version, occurredAt: row.occurred_at, correlationId: row.correlation_id, causationId: row.causation_id,
    idempotencyKey: row.idempotency_key, payload: JSON.parse(row.payload) as unknown,
  }),
});

/** Undispatched local events in commit order, for the local event dispatcher (M0-033). */
export function pendingLocalDispatch(store: EdgeStore, limit = 100): LocalEvent[] {
  return (store.db.prepare('select * from local_outbox where dispatched_at is null order by sequence limit ?').all(limit) as Row[]).map(toLocal);
}

export function markLocallyDispatched(store: EdgeStore, sequence: number): void {
  store.db.prepare('update local_outbox set dispatched_at = ? where sequence = ? and dispatched_at is null').run(new Date().toISOString(), sequence);
}

/** EDGE_TO_CLOUD events not yet acknowledged by the Cloud inbox, in sequence order (Edge Sync). */
export function pendingCloudSync(store: EdgeStore, limit = 100): LocalEvent[] {
  return (store.db.prepare(`select * from local_outbox where synced_at is null and plane = 'EDGE_TO_CLOUD' order by sequence limit ?`).all(limit) as Row[]).map(toLocal);
}

/** Records the Cloud inbox acknowledgement up to and including `sequence`. */
export function markSyncedThrough(store: EdgeStore, sequence: number): number {
  return store.db.prepare(`update local_outbox set synced_at = ? where synced_at is null and plane = 'EDGE_TO_CLOUD' and sequence <= ?`).run(new Date().toISOString(), sequence).changes;
}
