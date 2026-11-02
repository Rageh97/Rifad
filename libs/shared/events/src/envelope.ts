/** Durable event planes (ADR-041). Edge events never route through the Cloud relay. */
export const EVENT_PLANES = ['EDGE', 'CLOUD', 'EDGE_TO_CLOUD', 'CLOUD_TO_EDGE'] as const;
export type EventPlane = (typeof EVENT_PLANES)[number];

/** Ordering requirement declared per event (§25 Events; ADR-033). There is no global ordering. */
export const ORDERING_SCOPES = ['NONE', 'PER_AGGREGATE', 'PER_BRANCH'] as const;
export type OrderingScope = (typeof ORDERING_SCOPES)[number];

/**
 * Versioned durable envelope shared by the Cloud Postgres outbox and the Edge SQLite local outbox
 * (M0-019). Payloads must already be classified and free of card data.
 */
export interface EventEnvelope<Payload = unknown> {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly plane: EventPlane;
  readonly ordering: OrderingScope;
  readonly organizationId: string;
  readonly branchId: string | null;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly idempotencyKey: string;
  readonly payload: Payload;
}

export class EnvelopeError extends Error {
  constructor(readonly field: string) {
    super(`Invalid event envelope: ${field}`);
    this.name = 'EnvelopeError';
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const eventType = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+\.v([1-9]\d*)$/;
const token = /^[A-Za-z0-9._:-]{1,128}$/;
const aggregateType = /^[a-z][a-z0-9_]{0,63}$/;
const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
/** Bound on serialized payload size so one event cannot exhaust a relay or sync batch. */
export const MAX_PAYLOAD_BYTES = 64 * 1024;

/** Validates every field and returns a frozen copy; the caller's object is never trusted as-is. */
export function validateEnvelope<Payload>(input: EventEnvelope<Payload>): EventEnvelope<Payload> {
  const fail = (field: string): never => { throw new EnvelopeError(field); };
  if (typeof input !== 'object' || input === null) fail('envelope');
  if (!uuid.test(String(input.eventId))) fail('eventId');
  const version = eventType.exec(String(input.eventType))?.[1];
  if (!version) fail('eventType');
  if (input.eventVersion !== Number(version)) fail('eventVersion');
  if (!EVENT_PLANES.includes(input.plane)) fail('plane');
  if (!ORDERING_SCOPES.includes(input.ordering)) fail('ordering');
  if (!uuid.test(String(input.organizationId))) fail('organizationId');
  if (input.branchId !== null && !uuid.test(String(input.branchId))) fail('branchId');
  if (input.ordering === 'PER_BRANCH' && input.branchId === null) fail('branchId');
  if (!aggregateType.test(String(input.aggregateType))) fail('aggregateType');
  if (!uuid.test(String(input.aggregateId))) fail('aggregateId');
  if (!Number.isSafeInteger(input.aggregateVersion) || input.aggregateVersion < 1) fail('aggregateVersion');
  if (!isoUtc.test(String(input.occurredAt)) || !Number.isFinite(Date.parse(input.occurredAt))) fail('occurredAt');
  if (!token.test(String(input.correlationId))) fail('correlationId');
  if (input.causationId !== null && !uuid.test(String(input.causationId))) fail('causationId');
  if (!token.test(String(input.idempotencyKey))) fail('idempotencyKey');
  let serialized: string | undefined;
  try { serialized = JSON.stringify(input.payload); } catch { fail('payload'); }
  if (serialized === undefined || new TextEncoder().encode(serialized).length > MAX_PAYLOAD_BYTES) fail('payload');
  return Object.freeze({
    eventId: input.eventId, eventType: input.eventType, eventVersion: input.eventVersion, plane: input.plane, ordering: input.ordering,
    organizationId: input.organizationId, branchId: input.branchId, aggregateType: input.aggregateType, aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion, occurredAt: input.occurredAt, correlationId: input.correlationId, causationId: input.causationId,
    idempotencyKey: input.idempotencyKey, payload: JSON.parse(serialized as string) as Payload,
  });
}
