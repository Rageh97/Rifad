import { DomainError, Money, currency, domainEvent, type Clock, type DomainEvent } from '@rifad/kernel';
import type { CheckStatus, FinalizationReceipt, PreparationState } from '@rifad/ordering-contract';
import type { PriceSnapshot, SaleChannel } from '@rifad/pricing-contract';

export interface CheckLine {
  readonly lineId: string;
  readonly productId: string;
  readonly quantity: number;
  /** Immutable sale-time price (§9.1); never re-resolved after it is captured. */
  readonly price: PriceSnapshot;
  readonly roundId: string | null;
  readonly void: VoidRecord | null;
}

export interface VoidRecord {
  readonly reasonCode: string;
  readonly actorUserId: string;
  readonly approvedByUserId: string | null;
  readonly preparationState: PreparationState;
  readonly at: string;
}

export interface Round {
  readonly roundId: string;
  /** 1, 2, 3… per check: round #2 can follow round #1 (ADR-021). */
  readonly number: number;
  readonly lineIds: readonly string[];
  readonly submittedAt: string;
}

/** Open Check aggregate (M0-027): one model for dine-in, takeaway and delivery (G03, 2026-11-02). */
export interface Check {
  readonly checkId: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly channel: SaleChannel;
  readonly tableRef: string | null;
  readonly currency: string;
  readonly status: CheckStatus;
  readonly lines: readonly CheckLine[];
  readonly rounds: readonly Round[];
  readonly cancellation: { readonly reasonCode: string; readonly actorUserId: string; readonly approvedByUserId: string | null; readonly at: string } | null;
  readonly finalizationId: string | null;
  /** Per-aggregate version carried by every event (ADR-033). */
  readonly version: number;
}

export interface Changed {
  readonly check: Check;
  readonly events: readonly DomainEvent[];
}

const rule = (code: string, message: string) => new DomainError(code, message, 'rule_violation');
const invalid = (code: string, message: string) => new DomainError(code, message, 'validation');
const reasonPattern = /^[A-Z][A-Z0-9_]{1,63}$/;
const tableRefPattern = /^[A-Za-z0-9 ._-]{1,32}$/;

function requireOpen(check: Check): void {
  if (check.status !== 'OPEN') throw rule('CHECK_NOT_OPEN', 'Check is not open.');
}

function next(check: Check, changes: Partial<Check>, clock: Clock, eventType: string | undefined, payload: unknown): Changed {
  const updated: Check = Object.freeze({ ...check, ...changes, version: check.version + 1 });
  const events = eventType ? [domainEvent({ eventType, aggregateId: check.checkId, aggregateVersion: updated.version, payload }, clock)] : [];
  return Object.freeze({ check: updated, events: Object.freeze(events) });
}

export function openCheck(input: { checkId: string; organizationId: string; branchId: string; channel: SaleChannel; tableRef?: string | null; currency: string }, clock: Clock): Changed {
  currency(input.currency, 2);
  if (input.tableRef && !tableRefPattern.test(input.tableRef)) throw invalid('INVALID_TABLE_REF', 'Table reference is invalid.');
  if (input.channel === 'DINE_IN' && !input.tableRef) throw invalid('TABLE_REQUIRED', 'A dine-in check needs a table.');
  const check: Check = Object.freeze({
    checkId: input.checkId, organizationId: input.organizationId, branchId: input.branchId, channel: input.channel, tableRef: input.tableRef ?? null,
    currency: input.currency, status: 'OPEN', lines: Object.freeze([]), rounds: Object.freeze([]), cancellation: null, finalizationId: null, version: 1,
  });
  const event = domainEvent({ eventType: 'restaurant.check.opened.v1', aggregateId: check.checkId, aggregateVersion: 1,
    payload: { channel: check.channel, tableRef: check.tableRef } }, clock);
  return Object.freeze({ check, events: Object.freeze([event]) });
}

/** Adds an editable line with its sale-time price snapshot (M0-030). */
export function addLine(check: Check, input: { lineId: string; productId: string; quantity: number; price: PriceSnapshot }, clock: Clock): Changed {
  requireOpen(check);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.productId)) throw invalid('INVALID_PRODUCT_ID', 'Product ID must be a UUID.');
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 999) throw invalid('INVALID_QUANTITY', 'Quantity must be 1-999.');
  if (input.price.productId !== input.productId || input.price.currency !== check.currency || input.price.channel !== check.channel) {
    throw invalid('PRICE_SNAPSHOT_MISMATCH', 'Price snapshot does not match the line.');
  }
  Money.parse(input.price.unitAmount, currency(check.currency, 2));
  if (check.lines.some(line => line.lineId === input.lineId)) throw new DomainError('LINE_EXISTS', 'Line already exists.', 'conflict');
  const line: CheckLine = Object.freeze({ lineId: input.lineId, productId: input.productId, quantity: input.quantity, price: input.price, roundId: null, void: null });
  return next(check, { lines: Object.freeze([...check.lines, line]) }, clock, undefined, undefined);
}

/** Only lines not yet sent to the kitchen can change; sent lines are history (§9.1). */
export function changeQuantity(check: Check, lineId: string, quantity: number, clock: Clock): Changed {
  requireOpen(check);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw invalid('INVALID_QUANTITY', 'Quantity must be 1-999.');
  const line = check.lines.find(candidate => candidate.lineId === lineId);
  if (!line) throw new DomainError('LINE_NOT_FOUND', 'Line was not found.', 'not_found');
  if (line.roundId) throw rule('LINE_ALREADY_SUBMITTED', 'A submitted line cannot change; void it instead.');
  return next(check, { lines: Object.freeze(check.lines.map(candidate => (candidate.lineId === lineId ? Object.freeze({ ...candidate, quantity }) : candidate))) }, clock, undefined, undefined);
}

export function removeUnsubmittedLine(check: Check, lineId: string, clock: Clock): Changed {
  requireOpen(check);
  const line = check.lines.find(candidate => candidate.lineId === lineId);
  if (!line) throw new DomainError('LINE_NOT_FOUND', 'Line was not found.', 'not_found');
  if (line.roundId) throw rule('LINE_ALREADY_SUBMITTED', 'A submitted line cannot be removed; void it instead.');
  return next(check, { lines: Object.freeze(check.lines.filter(candidate => candidate.lineId !== lineId)) }, clock, undefined, undefined);
}

/** Sends every editable line to the kitchen as the next round; the check stays open for later rounds. */
export function submitRound(check: Check, roundId: string, clock: Clock): Changed {
  requireOpen(check);
  const pending = check.lines.filter(line => line.roundId === null && line.void === null);
  if (!pending.length) throw rule('ROUND_EMPTY', 'There is nothing to send to the kitchen.');
  const round: Round = Object.freeze({ roundId, number: check.rounds.length + 1, lineIds: Object.freeze(pending.map(line => line.lineId)), submittedAt: clock.now().toISOString() });
  const lines = Object.freeze(check.lines.map(line => (line.roundId === null && line.void === null ? Object.freeze({ ...line, roundId }) : line)));
  return next(check, { lines, rounds: Object.freeze([...check.rounds, round]) }, clock, 'restaurant.check_round.submitted.v1', {
    roundId, roundNumber: round.number,
    lines: pending.map(line => ({ lineId: line.lineId, productId: line.productId, quantity: line.quantity, unitAmount: line.price.unitAmount, currency: line.price.currency })),
  });
}

/**
 * Voids a line already sent to the kitchen: controlled reason code plus manager approval, recorded
 * with actor and preparation state (G03, 2026-11-02). Unsent lines are removed instead.
 */
export function voidSubmittedLine(check: Check, input: { lineId: string; reasonCode: string; actorUserId: string; approvedByUserId: string; preparationState: PreparationState }, clock: Clock): Changed {
  requireOpen(check);
  if (!reasonPattern.test(input.reasonCode)) throw invalid('INVALID_REASON_CODE', 'Reason code is invalid.');
  if (!input.approvedByUserId) throw rule('MANAGER_APPROVAL_REQUIRED', 'Voiding a sent item needs manager approval.');
  const line = check.lines.find(candidate => candidate.lineId === input.lineId);
  if (!line) throw new DomainError('LINE_NOT_FOUND', 'Line was not found.', 'not_found');
  if (!line.roundId) throw rule('LINE_NOT_SUBMITTED', 'Remove unsent lines instead of voiding them.');
  if (line.void) throw new DomainError('LINE_ALREADY_VOIDED', 'Line is already voided.', 'conflict');
  const record: VoidRecord = Object.freeze({ reasonCode: input.reasonCode, actorUserId: input.actorUserId, approvedByUserId: input.approvedByUserId, preparationState: input.preparationState, at: clock.now().toISOString() });
  const lines = Object.freeze(check.lines.map(candidate => (candidate.lineId === input.lineId ? Object.freeze({ ...candidate, void: record }) : candidate)));
  return next(check, { lines }, clock, 'restaurant.item.voided.v1', {
    lineId: line.lineId, roundId: line.roundId, productId: line.productId, quantity: line.quantity, reasonCode: record.reasonCode, preparationState: record.preparationState,
  });
}

/** Cancels an open check; once any round was sent it needs a reason and manager approval (G03). */
export function cancelCheck(check: Check, input: { reasonCode: string; actorUserId: string; approvedByUserId?: string }, clock: Clock): Changed {
  requireOpen(check);
  if (!reasonPattern.test(input.reasonCode)) throw invalid('INVALID_REASON_CODE', 'Reason code is invalid.');
  const sent = check.rounds.length > 0;
  if (sent && !input.approvedByUserId) throw rule('MANAGER_APPROVAL_REQUIRED', 'Cancelling a check with sent rounds needs manager approval.');
  const cancellation = Object.freeze({ reasonCode: input.reasonCode, actorUserId: input.actorUserId, approvedByUserId: input.approvedByUserId ?? null, at: cancellationTime(clock) });
  return next(check, { status: 'CANCELLED', cancellation }, clock, 'restaurant.check.cancelled.v1', { reasonCode: input.reasonCode, roundsSent: check.rounds.length });
}

const cancellationTime = (clock: Clock) => clock.now().toISOString();

/** OPEN → CLOSING once nothing is left unsent and something remains billable. */
export function beginClosing(check: Check, clock: Clock): Changed {
  requireOpen(check);
  if (check.lines.some(line => line.roundId === null && line.void === null)) throw rule('UNSENT_LINES', 'Send or remove unsent lines before closing.');
  if (!check.lines.some(line => line.void === null)) throw rule('NOTHING_TO_BILL', 'The check has no billable lines; cancel it instead.');
  return next(check, { status: 'CLOSING' }, clock, undefined, undefined);
}

/** CLOSING → OPEN when finalization was abandoned before completing (not a reopen of a CLOSED check). */
export function abandonClosing(check: Check, clock: Clock): Changed {
  if (check.status !== 'CLOSING') throw rule('CHECK_NOT_CLOSING', 'Check is not closing.');
  return next(check, { status: 'OPEN' }, clock, undefined, undefined);
}

/** CLOSING → CLOSED only with a Sale Finalization receipt (ADR-039). CLOSED is final: no reopen (G03). */
export function closeCheck(check: Check, receipt: FinalizationReceipt, clock: Clock): Changed {
  if (check.status !== 'CLOSING') throw rule('CHECK_NOT_CLOSING', 'Check is not closing.');
  if (receipt.checkId !== check.checkId || !receipt.finalizationId) throw rule('FINALIZATION_MISMATCH', 'Finalization does not belong to this check.');
  return next(check, { status: 'CLOSED', finalizationId: receipt.finalizationId }, clock, undefined, undefined);
}

/** Total of non-voided lines in exact minor units. */
export function checkTotal(check: Check): Money {
  const unit = currency(check.currency, 2);
  return check.lines.filter(line => line.void === null).reduce((sum, line) => sum.add(Money.parse(line.price.unitAmount, unit).times(line.quantity)), Money.zero(unit));
}
