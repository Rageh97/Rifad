import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { validateEnvelope } from '@rifad/events';
import { fixedClock } from '@rifad/kernel';
import { ORDERING_EVENT_TYPES, OrderingEventError, validateOrderingPayload } from '@rifad/ordering-contract';
import { addLine, cancelCheck, openCheck, submitRound, voidSubmittedLine } from './index';

const clock = fixedClock('2026-11-02T12:00:00.000Z');
const organizationId = randomUUID();
const branchId = randomUUID();
const productId = randomUUID();

test('every produced Ordering event validates as a payload and durable envelope', () => {
  const checkId = randomUUID();
  const opened = openCheck({ checkId, organizationId, branchId, channel: 'DINE_IN', tableRef: 'T1', currency: 'EGP' }, clock);
  const firstLineId = randomUUID();
  const first = addLine(opened.check, { lineId: firstLineId, productId, quantity: 2,
    price: { productId, unitAmount: '12.50', currency: 'EGP', priceListId: null, channel: 'DINE_IN', resolvedAt: clock.now().toISOString() } }, clock);
  const roundOne = submitRound(first.check, randomUUID(), clock);
  const secondLineId = randomUUID();
  const second = addLine(roundOne.check, { lineId: secondLineId, productId, quantity: 1,
    price: { productId, unitAmount: '12.50', currency: 'EGP', priceListId: null, channel: 'DINE_IN', resolvedAt: clock.now().toISOString() } }, clock);
  const roundTwo = submitRound(second.check, randomUUID(), clock);
  const voided = voidSubmittedLine(roundTwo.check, { lineId: firstLineId, reasonCode: 'DAMAGED', actorUserId: randomUUID(), approvedByUserId: randomUUID(), preparationState: 'PREPARED' }, clock);
  const cancelled = cancelCheck(voided.check, { reasonCode: 'CUSTOMER_REQUEST', actorUserId: randomUUID(), approvedByUserId: randomUUID() }, clock);
  const events = [opened, roundOne, roundTwo, voided, cancelled].flatMap(change => change.events);

  assert.deepEqual(events.map(event => event.eventType), [
    ORDERING_EVENT_TYPES.checkOpened, ORDERING_EVENT_TYPES.roundSubmitted,
    ORDERING_EVENT_TYPES.roundSubmitted, ORDERING_EVENT_TYPES.itemVoided, ORDERING_EVENT_TYPES.checkCancelled,
  ]);
  assert.deepEqual(events.map(event => event.aggregateVersion), [1, 3, 5, 6, 7]);
  assert.deepEqual(events.filter(event => event.eventType === ORDERING_EVENT_TYPES.roundSubmitted).map(event => (event.payload as { roundNumber: number }).roundNumber), [1, 2]);
  for (const event of events) {
    validateOrderingPayload(event.eventType, event.payload);
    assert.equal(validateEnvelope({ ...event, eventId: randomUUID(), plane: 'EDGE', ordering: 'PER_AGGREGATE',
      organizationId, branchId, aggregateType: 'check', correlationId: randomUUID(), causationId: null,
      idempotencyKey: randomUUID() }).aggregateVersion, event.aggregateVersion);
  }
});

test('Ordering payload validator rejects unknown types and malformed fields', () => {
  const round = { roundId: randomUUID(), roundNumber: 1, lines: [{ lineId: randomUUID(), productId, quantity: 1, unitAmount: '12.50', currency: 'EGP' }] };
  const voided = { lineId: randomUUID(), roundId: randomUUID(), productId, quantity: 1, reasonCode: 'DAMAGED', preparationState: 'PREPARED' };
  const invalid: [string, unknown, string][] = [
    ['restaurant.unknown.v1', {}, 'eventType'],
    [ORDERING_EVENT_TYPES.checkOpened, null, 'payload'],
    [ORDERING_EVENT_TYPES.checkOpened, { channel: 'OTHER', tableRef: null }, 'channel'],
    [ORDERING_EVENT_TYPES.checkOpened, { channel: 'DINE_IN', tableRef: 'x'.repeat(33) }, 'tableRef'],
    [ORDERING_EVENT_TYPES.roundSubmitted, { ...round, roundId: 'bad' }, 'roundId'],
    [ORDERING_EVENT_TYPES.roundSubmitted, { ...round, roundNumber: 0 }, 'roundNumber'],
    [ORDERING_EVENT_TYPES.roundSubmitted, { ...round, lines: [] }, 'lines'],
    [ORDERING_EVENT_TYPES.roundSubmitted, { ...round, lines: Array(501).fill(round.lines[0]) }, 'lines'],
    [ORDERING_EVENT_TYPES.roundSubmitted, { ...round, lines: [{ ...round.lines[0], productId: 'bad' }] }, 'lines.id'],
    [ORDERING_EVENT_TYPES.roundSubmitted, { ...round, lines: [{ ...round.lines[0], quantity: 1000 }] }, 'lines.quantity'],
    [ORDERING_EVENT_TYPES.roundSubmitted, { ...round, lines: [{ ...round.lines[0], unitAmount: '12.12345' }] }, 'lines.price'],
    [ORDERING_EVENT_TYPES.roundSubmitted, { ...round, lines: [{ ...round.lines[0], currency: 'egp' }] }, 'lines.price'],
    [ORDERING_EVENT_TYPES.itemVoided, { ...voided, lineId: 'bad' }, 'ids'],
    [ORDERING_EVENT_TYPES.itemVoided, { ...voided, quantity: 0 }, 'quantity'],
    [ORDERING_EVENT_TYPES.itemVoided, { ...voided, reasonCode: 'bad' }, 'reasonCode'],
    [ORDERING_EVENT_TYPES.itemVoided, { ...voided, preparationState: 'UNKNOWN' }, 'preparationState'],
    [ORDERING_EVENT_TYPES.checkCancelled, { reasonCode: 'bad', roundsSent: 0 }, 'reasonCode'],
    [ORDERING_EVENT_TYPES.checkCancelled, { reasonCode: 'CUSTOMER_REQUEST', roundsSent: -1 }, 'roundsSent'],
  ];
  for (const [type, payload, field] of invalid) {
    assert.throws(() => validateOrderingPayload(type, payload), error => error instanceof OrderingEventError && error.field === field);
  }
});
