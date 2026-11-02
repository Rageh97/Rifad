import { DomainError, newEntityId, type Clock, type DomainEvent } from '@rifad/kernel';
import type { FinalizationReceipt, PreparationState } from '@rifad/ordering-contract';
import {
  abandonClosing, addLine, beginClosing, cancelCheck, changeQuantity, closeCheck, openCheck, removeUnsubmittedLine, submitRound, voidSubmittedLine,
  type Changed, type Check,
} from '@rifad/ordering-domain';
import type { PricingPort, SaleChannel } from '@rifad/pricing-contract';

/** Check persistence inside one local transaction (Edge runtime profile, §24.1). */
export interface CheckRepository {
  get(checkId: string): Check | undefined;
  insert(check: Check): void;
  update(check: Check, expectedVersion: number): void;
}

/** Appends the aggregate's events to the local outbox in the same transaction (§31.1). */
export interface CheckEventSink {
  append(check: Check, events: readonly DomainEvent[]): void;
}

/** Synchronous unit of work: state change and events commit together or not at all. */
export interface OrderingUnitOfWork {
  run<T>(work: (checks: CheckRepository, events: CheckEventSink) => T): T;
}

const notFound = () => new DomainError('CHECK_NOT_FOUND', 'Check was not found.', 'not_found');

/**
 * Ordering commands for the branch Edge (M0-028/030/031). The Edge is the only writer of branch
 * checks (ADR-037); callers have already passed the permission pipeline for the action.
 */
export function orderingCommands(unitOfWork: OrderingUnitOfWork, pricing: PricingPort, clock: Clock) {
  const mutate = (checkId: string, change: (check: Check) => Changed): Check =>
    unitOfWork.run((checks, events) => {
      const current = checks.get(checkId);
      if (!current) throw notFound();
      const changed = change(current);
      checks.update(changed.check, current.version);
      events.append(changed.check, changed.events);
      return changed.check;
    });

  return Object.freeze({
    openCheck(input: { organizationId: string; branchId: string; channel: SaleChannel; tableRef?: string | null; currency: string }): Check {
      return unitOfWork.run((checks, events) => {
        const changed = openCheck({ checkId: newEntityId<'check'>(), ...input }, clock);
        checks.insert(changed.check);
        events.append(changed.check, changed.events);
        return changed.check;
      });
    },

    /** The price is resolved before the transaction and frozen on the line as a snapshot (M0-026). */
    async addItem(checkId: string, input: { productId: string; quantity: number }): Promise<Check> {
      const check = unitOfWork.run(checks => checks.get(checkId));
      if (!check) throw notFound();
      const price = await pricing.resolve({ organizationId: check.organizationId, branchId: check.branchId, productId: input.productId, channel: check.channel, at: clock.now().toISOString() });
      if (!price) throw new DomainError('PRICE_NOT_AVAILABLE', 'The product has no effective price.', 'rule_violation');
      return mutate(checkId, current => addLine(current, { lineId: newEntityId<'check_line'>(), productId: input.productId, quantity: input.quantity, price }, clock));
    },

    changeQuantity: (checkId: string, lineId: string, quantity: number) => mutate(checkId, check => changeQuantity(check, lineId, quantity, clock)),
    removeLine: (checkId: string, lineId: string) => mutate(checkId, check => removeUnsubmittedLine(check, lineId, clock)),

    /** Round state and its `check_round.submitted` event commit atomically, online or offline (M0-031). */
    submitRound: (checkId: string) => mutate(checkId, check => submitRound(check, newEntityId<'round'>(), clock)),

    voidLine: (checkId: string, input: { lineId: string; reasonCode: string; actorUserId: string; approvedByUserId: string; preparationState: PreparationState }) =>
      mutate(checkId, check => voidSubmittedLine(check, input, clock)),
    cancel: (checkId: string, input: { reasonCode: string; actorUserId: string; approvedByUserId?: string }) =>
      mutate(checkId, check => cancelCheck(check, input, clock)),
    beginClosing: (checkId: string) => mutate(checkId, check => beginClosing(check, clock)),
    abandonClosing: (checkId: string) => mutate(checkId, check => abandonClosing(check, clock)),
    close: (checkId: string, receipt: FinalizationReceipt) => mutate(checkId, check => closeCheck(check, receipt, clock)),
    get: (checkId: string): Check | undefined => unitOfWork.run(checks => checks.get(checkId)),
  });
}

export type OrderingCommands = ReturnType<typeof orderingCommands>;
