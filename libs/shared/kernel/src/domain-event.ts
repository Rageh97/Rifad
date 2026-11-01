import type { Clock } from './clock';

/**
 * Fact raised by an aggregate. Carries its per-aggregate version (ADR-033) and a UTC occurredAt
 * (ADR-016). Durable envelope fields (event ID, tenant/branch, correlation, plane, sequence) are
 * added by the event envelope contract (M0-019/032), not here.
 */
export interface DomainEvent<Type extends string = string, Payload = unknown> {
  readonly eventType: Type;
  readonly eventVersion: number;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly occurredAt: string;
  readonly payload: Payload;
}

/** Catalog naming, e.g. restaurant.check_round.submitted.v1 (§33). */
const eventTypePattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+\.v([1-9]\d*)$/;

export function domainEvent<Type extends string, Payload>(
  input: { eventType: Type; aggregateId: string; aggregateVersion: number; payload: Payload },
  clock: Clock,
): DomainEvent<Type, Payload> {
  const version = eventTypePattern.exec(input.eventType)?.[1];
  if (!version) throw new TypeError('Event type must follow <context>.<name>.v<version>');
  if (!Number.isSafeInteger(input.aggregateVersion) || input.aggregateVersion < 1) throw new TypeError('aggregateVersion must be a positive integer');
  if (!input.aggregateId) throw new TypeError('aggregateId is required');
  return Object.freeze({
    eventType: input.eventType,
    eventVersion: Number(version),
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    occurredAt: clock.now().toISOString(),
    payload: input.payload,
  });
}
