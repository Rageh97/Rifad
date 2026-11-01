import { DomainError } from './domain-error';

declare const brand: unique symbol;

/** Offline-safe UUID identity (ADR-017), branded so identifiers of different entities do not mix. */
export type EntityId<Kind extends string> = string & { readonly [brand]: Kind };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Accepts only canonical lowercase RFC 9562 UUIDs; never normalizes caller input silently. */
export function parseEntityId<Kind extends string>(value: unknown): EntityId<Kind> {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new DomainError('INVALID_ENTITY_ID', 'Identifier is not a canonical UUID.', 'validation');
  return value as EntityId<Kind>;
}

/** Generates an identity locally, without a central sequence, so Edge and Cloud can create IDs while disconnected. */
export function newEntityId<Kind extends string>(): EntityId<Kind> {
  return parseEntityId<Kind>(globalThis.crypto.randomUUID());
}
