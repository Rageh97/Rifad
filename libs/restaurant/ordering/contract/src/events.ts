/**
 * Versioned Ordering event payloads (M0-032, §33). The envelope (`@rifad/events`) carries tenant,
 * branch, check ID, aggregate version, correlation and time; these are only the payloads. A
 * published version never changes shape: a breaking change is a new `.v2` type.
 */

export const ORDERING_EVENT_TYPES = Object.freeze({
  checkOpened: 'restaurant.check.opened.v1',
  roundSubmitted: 'restaurant.check_round.submitted.v1',
  itemVoided: 'restaurant.item.voided.v1',
  checkCancelled: 'restaurant.check.cancelled.v1',
} as const);

export interface CheckOpenedV1 {
  readonly channel: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  readonly tableRef: string | null;
}

/** The immutable-ish kitchen boundary (§32.1): what was sent, at which price, in which round. */
export interface CheckRoundSubmittedV1 {
  readonly roundId: string;
  readonly roundNumber: number;
  readonly lines: readonly { readonly lineId: string; readonly productId: string; readonly quantity: number; readonly unitAmount: string; readonly currency: string }[];
}

export interface ItemVoidedV1 {
  readonly lineId: string;
  readonly roundId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly reasonCode: string;
  readonly preparationState: 'NOT_STARTED' | 'IN_PREPARATION' | 'PREPARED';
}

export interface CheckCancelledV1 {
  readonly reasonCode: string;
  readonly roundsSent: number;
}

export class OrderingEventError extends Error {
  constructor(readonly eventType: string, readonly field: string) {
    super(`Invalid ${eventType} payload: ${field}`);
    this.name = 'OrderingEventError';
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const decimal = /^-?(0|[1-9]\d{0,17})(\.\d{1,4})?$/;
const reason = /^[A-Z][A-Z0-9_]{1,63}$/;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const positiveInt = (value: unknown, max: number) => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= max;

/** Strict payload checks so a consumer rejects malformed or tampered events instead of guessing. */
const validators: Readonly<Record<string, (payload: Record<string, unknown>) => string | undefined>> = {
  [ORDERING_EVENT_TYPES.checkOpened]: p =>
    !['DINE_IN', 'TAKEAWAY', 'DELIVERY'].includes(p['channel'] as string) ? 'channel'
      : !(p['tableRef'] === null || (typeof p['tableRef'] === 'string' && (p['tableRef'] as string).length <= 32)) ? 'tableRef' : undefined,
  [ORDERING_EVENT_TYPES.roundSubmitted]: p => {
    if (!uuid.test(String(p['roundId']))) return 'roundId';
    if (!positiveInt(p['roundNumber'], 10_000)) return 'roundNumber';
    const lines = p['lines'];
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 500) return 'lines';
    for (const line of lines) {
      if (!isObject(line) || !uuid.test(String(line['lineId'])) || !uuid.test(String(line['productId']))) return 'lines.id';
      if (!positiveInt(line['quantity'], 999)) return 'lines.quantity';
      if (!decimal.test(String(line['unitAmount'])) || !/^[A-Z]{3}$/.test(String(line['currency']))) return 'lines.price';
    }
    return undefined;
  },
  [ORDERING_EVENT_TYPES.itemVoided]: p =>
    !uuid.test(String(p['lineId'])) || !uuid.test(String(p['roundId'])) || !uuid.test(String(p['productId'])) ? 'ids'
      : !positiveInt(p['quantity'], 999) ? 'quantity'
        : !reason.test(String(p['reasonCode'])) ? 'reasonCode'
          : !['NOT_STARTED', 'IN_PREPARATION', 'PREPARED'].includes(p['preparationState'] as string) ? 'preparationState' : undefined,
  [ORDERING_EVENT_TYPES.checkCancelled]: p =>
    !reason.test(String(p['reasonCode'])) ? 'reasonCode' : !(Number.isSafeInteger(p['roundsSent']) && (p['roundsSent'] as number) >= 0) ? 'roundsSent' : undefined,
};

/** Validates a payload for a known Ordering event type; unknown types are rejected. */
export function validateOrderingPayload(eventType: string, payload: unknown): void {
  const validate = validators[eventType];
  if (!validate) throw new OrderingEventError(eventType, 'eventType');
  if (!isObject(payload)) throw new OrderingEventError(eventType, 'payload');
  const field = validate(payload);
  if (field) throw new OrderingEventError(eventType, field);
}
