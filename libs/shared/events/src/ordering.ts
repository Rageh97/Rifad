import type { EventEnvelope } from './envelope';

/** Outcome for one delivery against the consumer's last applied position (ADR-033). */
export type OrderingDecision = 'APPLY' | 'DUPLICATE' | 'GAP';

/**
 * Pure sequence comparison: the next position applies, an already-seen position is a harmless
 * duplicate, and a jump forward is a gap the consumer must hold and surface, never skip silently.
 */
export function classifyPosition(lastApplied: number | undefined, incoming: number): OrderingDecision {
  if (!Number.isSafeInteger(incoming) || incoming < 1) throw new TypeError('Position must be a positive integer');
  const last = lastApplied ?? 0;
  if (incoming <= last) return 'DUPLICATE';
  return incoming === last + 1 ? 'APPLY' : 'GAP';
}

/**
 * Ordering key for an envelope under its declared scope; `undefined` for NONE. There is no global
 * ordering: two aggregates never block each other. PER_BRANCH events use a branch-level sequence
 * supplied by the producer's plane (e.g. the Edge source sequence in the Cloud inbox).
 */
export function orderingKey(envelope: Pick<EventEnvelope, 'ordering' | 'organizationId' | 'branchId' | 'aggregateType' | 'aggregateId'>): string | undefined {
  switch (envelope.ordering) {
    case 'NONE': return undefined;
    case 'PER_AGGREGATE': return `${envelope.organizationId}/${envelope.aggregateType}/${envelope.aggregateId}`;
    case 'PER_BRANCH':
      if (!envelope.branchId) throw new TypeError('PER_BRANCH ordering requires a branch');
      return `${envelope.organizationId}/branch/${envelope.branchId}`;
  }
}

export interface OrderingObservation {
  readonly key: string;
  readonly expected: number;
  readonly received: number;
}

/**
 * In-process ordering guard for one consumer. It deduplicates NONE events by eventId. A GAP is not
 * applied and does not advance the position: the delivery must be retried after the missing
 * positions arrive, and each gap is reported through `onGap`. Durable consumers persist the same
 * positions alongside their effects.
 */
export function createOrderingGuard(options: { onGap?: (gap: OrderingObservation) => void; maxSeenIds?: number } = {}) {
  const positions = new Map<string, number>();
  const seen = new Set<string>();
  const maxSeen = options.maxSeenIds ?? 10_000;
  return Object.freeze({
    decide(envelope: Pick<EventEnvelope, 'eventId' | 'ordering' | 'organizationId' | 'branchId' | 'aggregateType' | 'aggregateId' | 'aggregateVersion'>, position = envelope.aggregateVersion): OrderingDecision {
      const key = orderingKey(envelope);
      if (key === undefined) {
        if (seen.has(envelope.eventId)) return 'DUPLICATE';
        seen.add(envelope.eventId);
        if (seen.size > maxSeen) seen.delete(seen.values().next().value as string);
        return 'APPLY';
      }
      const decision = classifyPosition(positions.get(key), position);
      if (decision === 'APPLY') positions.set(key, position);
      if (decision === 'GAP') options.onGap?.({ key, expected: (positions.get(key) ?? 0) + 1, received: position });
      return decision;
    },
    position(key: string): number | undefined {
      return positions.get(key);
    },
  });
}

export type OrderingGuard = ReturnType<typeof createOrderingGuard>;
