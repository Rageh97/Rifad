import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fixedClock } from '@rifad/kernel';
import { abandonClosing, addLine, beginClosing, cancelCheck, changeQuantity, checkTotal, closeCheck, openCheck, removeUnsubmittedLine, submitRound, voidSubmittedLine } from './index';

const clock = fixedClock('2026-11-02T12:00:00.000Z');
const organizationId = randomUUID();
const branchId = randomUUID();
const productId = randomUUID();
const actorUserId = randomUUID();
const approvedByUserId = randomUUID();
const open = () => openCheck({ checkId: randomUUID(), organizationId, branchId, channel: 'DINE_IN', tableRef: 'T1', currency: 'EGP' }, clock).check;
const line = (check: ReturnType<typeof open>, lineId = randomUUID(), quantity = 2) => addLine(check, { lineId, productId, quantity,
  price: { productId, unitAmount: '12.50', currency: 'EGP', priceListId: null, channel: 'DINE_IN', resolvedAt: clock.now().toISOString() } }, clock).check;
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;

test('dine-in needs a table; unsent lines change, sent lines stay historical and can be voided with approval', () => {
  assert.throws(() => openCheck({ checkId: randomUUID(), organizationId, branchId, channel: 'DINE_IN', currency: 'EGP' }, clock), code('TABLE_REQUIRED'));
  const firstId = randomUUID();
  const added = line(open(), firstId);
  const changed = changeQuantity(added, firstId, 3, clock).check;
  assert.deepEqual(checkTotal(changed).toJSON(), { amount: '37.50', currency: 'EGP' });
  assert.equal(removeUnsubmittedLine(changed, firstId, clock).check.lines.length, 0);
  const sent = submitRound(changed, randomUUID(), clock).check;
  assert.throws(() => changeQuantity(sent, firstId, 4, clock), code('LINE_ALREADY_SUBMITTED'));
  assert.throws(() => removeUnsubmittedLine(sent, firstId, clock), code('LINE_ALREADY_SUBMITTED'));
  assert.throws(() => voidSubmittedLine(sent, { lineId: firstId, reasonCode: 'DAMAGED', actorUserId, approvedByUserId: '', preparationState: 'PREPARED' }, clock), code('MANAGER_APPROVAL_REQUIRED'));
  const voided = voidSubmittedLine(sent, { lineId: firstId, reasonCode: 'DAMAGED', actorUserId, approvedByUserId, preparationState: 'PREPARED' }, clock).check;
  assert.equal(voided.lines[0]?.void?.reasonCode, 'DAMAGED');
  assert.deepEqual(checkTotal(voided).toJSON(), { amount: '0.00', currency: 'EGP' });
  assert.throws(() => voidSubmittedLine(voided, { lineId: firstId, reasonCode: 'DAMAGED', actorUserId, approvedByUserId, preparationState: 'PREPARED' }, clock), code('LINE_ALREADY_VOIDED'));
});

test('closing needs a billable sent line and matching finalization receipt; closed and cancelled are final', () => {
  assert.throws(() => beginClosing(open(), clock), code('NOTHING_TO_BILL'));
  const added = line(open());
  assert.throws(() => beginClosing(added, clock), code('UNSENT_LINES'));
  const sent = submitRound(added, randomUUID(), clock).check;
  const closing = beginClosing(sent, clock).check;
  assert.equal(closing.status, 'CLOSING');
  assert.equal(abandonClosing(closing, clock).check.status, 'OPEN');
  assert.throws(() => closeCheck(closing, { checkId: randomUUID(), finalizationId: randomUUID(), finalizedAt: clock.now().toISOString() }, clock), code('FINALIZATION_MISMATCH'));
  const closed = closeCheck(closing, { checkId: closing.checkId, finalizationId: randomUUID(), finalizedAt: clock.now().toISOString() }, clock).check;
  assert.equal(closed.status, 'CLOSED');
  assert.throws(() => abandonClosing(closed, clock), code('CHECK_NOT_CLOSING'));
  assert.throws(() => cancelCheck(sent, { reasonCode: 'CUSTOMER_REQUEST', actorUserId }, clock), code('MANAGER_APPROVAL_REQUIRED'));
  const cancelled = cancelCheck(sent, { reasonCode: 'CUSTOMER_REQUEST', actorUserId, approvedByUserId }, clock).check;
  assert.equal(cancelled.status, 'CANCELLED');
  assert.throws(() => beginClosing(cancelled, clock), code('CHECK_NOT_OPEN'));
});
