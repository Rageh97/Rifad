import { createHash } from 'node:crypto';
import { sql, type QueryExecutorProvider } from 'kysely';

/** One Edge-originated operation as received by the Cloud (owner: sync module; migration 0004). */
export interface InboundOperation {
  readonly organizationId: string;
  /** Edge runtime identity whose local outbox produced the operation. */
  readonly sourceId: string;
  /** Idempotency key: the same operation delivered twice has one Cloud effect. */
  readonly operationId: string;
  /** Monotonic per source; gaps are recorded, never silently skipped. */
  readonly sourceSequence: number;
  readonly operationType: string;
  readonly payload: unknown;
}

export type InboxOutcome = 'APPLIED' | 'APPLIED_WITH_GAP' | 'DUPLICATE';

export class InboxError extends Error {
  constructor(readonly code: 'INBOX_OPERATION_CONFLICT' | 'INBOX_SEQUENCE_CONFLICT' | 'INBOX_INVALID_OPERATION') {
    super(code);
    this.name = 'InboxError';
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Canonical JSON (sorted keys) so equal payloads hash equally regardless of key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  const text = JSON.stringify(value);
  if (text === undefined) throw new InboxError('INBOX_INVALID_OPERATION');
  return text;
}

/**
 * Records an operation and applies its projection effect in the caller's tenant transaction (M0-022).
 * A redelivery with the same operation ID and payload is a harmless DUPLICATE; the same ID with
 * different content, or a different operation at a used sequence, is a conflict for operators.
 */
export async function receiveOperation(trx: QueryExecutorProvider, operation: InboundOperation, apply: () => Promise<void>): Promise<InboxOutcome> {
  if (![operation.organizationId, operation.sourceId, operation.operationId].every(id => uuid.test(id))
    || !Number.isSafeInteger(operation.sourceSequence) || operation.sourceSequence < 1 || !/^[a-z][a-z0-9_.]{0,127}$/.test(operation.operationType)) {
    throw new InboxError('INBOX_INVALID_OPERATION');
  }
  const hash = createHash('sha256').update(canonical(operation.payload)).digest('hex');
  let inserted: boolean;
  try {
    const result = await sql<{ operation_id: string }>`
      insert into sync.inbox (organization_id, source_id, operation_id, source_sequence, operation_type, payload_hash)
      values (${operation.organizationId}, ${operation.sourceId}, ${operation.operationId}, ${operation.sourceSequence}, ${operation.operationType}, ${hash})
      on conflict (organization_id, operation_id) do nothing
      returning operation_id`.execute(trx);
    inserted = result.rows.length === 1;
  } catch (error) {
    if ((error as { code?: unknown; constraint?: unknown }).constraint === 'inbox_source_sequence') throw new InboxError('INBOX_SEQUENCE_CONFLICT');
    throw error;
  }
  if (!inserted) {
    const existing = (await sql<{ payload_hash: string; source_id: string; source_sequence: string }>`
      select payload_hash, source_id, source_sequence from sync.inbox where organization_id = ${operation.organizationId} and operation_id = ${operation.operationId}`.execute(trx)).rows[0];
    if (!existing || existing.payload_hash !== hash || existing.source_id !== operation.sourceId || Number(existing.source_sequence) !== operation.sourceSequence) {
      throw new InboxError('INBOX_OPERATION_CONFLICT');
    }
    return 'DUPLICATE';
  }
  await apply();
  const previous = (await sql<{ previous: string | null }>`
    select max(source_sequence) as previous from sync.inbox
    where organization_id = ${operation.organizationId} and source_id = ${operation.sourceId} and source_sequence < ${operation.sourceSequence}`.execute(trx)).rows[0]?.previous;
  return Number(previous ?? 0) === operation.sourceSequence - 1 ? 'APPLIED' : 'APPLIED_WITH_GAP';
}

export interface SequenceGap {
  readonly from: number;
  readonly to: number;
}

/** Missing sequence ranges for one Edge source, so sync lag/loss is observable (M0-022 acceptance). */
export async function sequenceGaps(trx: QueryExecutorProvider, organizationId: string, sourceId: string): Promise<SequenceGap[]> {
  const rows = (await sql<{ from: string; to: string }>`
    select previous + 1 as from, source_sequence - 1 as to from (
      select source_sequence, coalesce(lag(source_sequence) over (order by source_sequence), 0) as previous
      from sync.inbox where organization_id = ${organizationId} and source_id = ${sourceId}) ordered
    where source_sequence > previous + 1 order by 1`.execute(trx)).rows;
  return rows.map(row => ({ from: Number(row.from), to: Number(row.to) }));
}
