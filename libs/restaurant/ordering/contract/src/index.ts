import type { PriceSnapshot, SaleChannel } from '@rifad/pricing-contract';

/**
 * Public contract of the Ordering context (Open Check, ADR-021/037). Branch-owned: the Edge is the
 * only writer; the Cloud holds a synced projection (§13).
 */

export type CheckStatus = 'OPEN' | 'CLOSING' | 'CLOSED' | 'CANCELLED';
/** Kitchen state recorded with a void, so waste/consumption reversal can follow (§29.1). */
export type PreparationState = 'NOT_STARTED' | 'IN_PREPARATION' | 'PREPARED';

export interface CheckLineView {
  readonly lineId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly price: PriceSnapshot;
  /** Round that sent the line to the kitchen; null while still editable. */
  readonly roundId: string | null;
  readonly voided: boolean;
}

export interface CheckView {
  readonly checkId: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly channel: SaleChannel;
  readonly tableRef: string | null;
  readonly status: CheckStatus;
  readonly lines: readonly CheckLineView[];
  readonly roundCount: number;
  readonly version: number;
}

/**
 * Proof that Sale Finalization completed (ADR-039): tender allocation, Billing document and required
 * fiscal state persisted locally. Only Payments/Billing/Fiscalization issue it (G06); Ordering cannot
 * move a check to CLOSED without one.
 */
export interface FinalizationReceipt {
  readonly checkId: string;
  readonly finalizationId: string;
  readonly finalizedAt: string;
}

export { ORDERING_EVENT_TYPES, OrderingEventError, validateOrderingPayload } from './events';
export type { CheckCancelledV1, CheckOpenedV1, CheckRoundSubmittedV1, ItemVoidedV1 } from './events';
