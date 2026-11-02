import { sql, type Kysely, type Transaction } from 'kysely';
import { withTransaction } from '@rifad/database';
import { classifyPosition, orderingKey, validateEnvelope, type EventEnvelope } from '@rifad/events';

/** A consumer's effect; it runs inside the tenant transaction that also records the delivery. */
export type EventHandler<DB = unknown> = (trx: Transaction<DB>, envelope: EventEnvelope) => Promise<void>;

export type ConsumeOutcome = 'APPLIED' | 'DUPLICATE';

/**
 * Thrown when a PER_AGGREGATE event arrives ahead of a missing version. The transaction rolls back
 * (nothing is recorded), so the queue's retry/backoff redelivers it after the gap is filled (ADR-033).
 */
export class OrderingGapError extends Error {
  constructor(readonly consumer: string, readonly expected: number, readonly received: number) {
    super(`ORDERING_GAP: ${consumer} expected ${expected} received ${received}`);
    this.name = 'OrderingGapError';
  }
}

const consumerPattern = /^[a-z][a-z0-9_.-]{0,63}$/;

/**
 * Durable, idempotent delivery of one Cloud event to one named consumer (M0-022/047). In one tenant
 * transaction it records the event as processed (a redelivery is a harmless DUPLICATE), checks the
 * per-aggregate position, runs the handler and advances the position, so the handler's database
 * effect happens exactly once even though the queue delivers at least once.
 *
 * PER_BRANCH events have no branch sequence in the envelope yet, so they are deduplicated by event
 * ID only, like NONE; branch-level ordering stays with the Edge -> Cloud inbox sequence.
 */
export async function consumeEvent<DB>(db: Kysely<DB>, consumer: string, input: EventEnvelope, handler: EventHandler<DB>): Promise<ConsumeOutcome> {
  if (!consumerPattern.test(consumer)) throw new TypeError('Invalid consumer name');
  const envelope = validateEnvelope(input);
  return withTransaction(db, { organizationId: envelope.organizationId }, async trx => {
    const recorded = await sql<{ event_id: string }>`
      insert into events.consumer_processed (organization_id, consumer, event_id)
      values (${envelope.organizationId}, ${consumer}, ${envelope.eventId})
      on conflict do nothing returning event_id`.execute(trx);
    if (recorded.rows.length === 0) return 'DUPLICATE';
    const key = envelope.ordering === 'PER_AGGREGATE' ? orderingKey(envelope) : undefined;
    if (key !== undefined) {
      const current = (await sql<{ position: string }>`
        select position from events.consumer_position
        where organization_id = ${envelope.organizationId} and consumer = ${consumer} and ordering_key = ${key}
        for update`.execute(trx)).rows[0];
      const last = current ? Number(current.position) : undefined;
      const decision = classifyPosition(last, envelope.aggregateVersion);
      // An older version under a new event ID was superseded; keep it recorded and skip the effect.
      if (decision === 'DUPLICATE') return 'DUPLICATE';
      if (decision === 'GAP') throw new OrderingGapError(consumer, (last ?? 0) + 1, envelope.aggregateVersion);
      await handler(trx, envelope);
      await sql`
        insert into events.consumer_position (organization_id, consumer, ordering_key, position)
        values (${envelope.organizationId}, ${consumer}, ${key}, ${envelope.aggregateVersion})
        on conflict (organization_id, consumer, ordering_key)
        do update set position = excluded.position, updated_at = now()`.execute(trx);
      return 'APPLIED';
    }
    await handler(trx, envelope);
    return 'APPLIED';
  });
}
