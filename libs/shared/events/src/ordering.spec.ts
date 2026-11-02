import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { classifyPosition, createOrderingGuard, orderingKey, type OrderingObservation } from './index';

const org = randomUUID();
const event = (aggregateId: string, aggregateVersion: number, ordering: 'NONE' | 'PER_AGGREGATE' | 'PER_BRANCH' = 'PER_AGGREGATE', branchId: string | null = null) =>
  ({ eventId: randomUUID(), ordering, organizationId: org, branchId, aggregateType: 'check', aggregateId, aggregateVersion });

test('positions classify as apply, duplicate or gap', () => {
  assert.equal(classifyPosition(undefined, 1), 'APPLY');
  assert.equal(classifyPosition(3, 4), 'APPLY');
  assert.equal(classifyPosition(3, 3), 'DUPLICATE');
  assert.equal(classifyPosition(3, 1), 'DUPLICATE');
  assert.equal(classifyPosition(3, 5), 'GAP');
  assert.equal(classifyPosition(undefined, 2), 'GAP');
  for (const bad of [0, -1, 1.5, Number.NaN]) assert.throws(() => classifyPosition(1, bad), TypeError);
});

test('duplicates are harmless, out-of-order is held and gaps are observable per aggregate', () => {
  const gaps: OrderingObservation[] = [];
  const guard = createOrderingGuard({ onGap: gap => gaps.push(gap) });
  const a = randomUUID();
  assert.deepEqual([1, 2, 2, 4, 3, 4, 1].map(version => guard.decide(event(a, version))), ['APPLY', 'APPLY', 'DUPLICATE', 'GAP', 'APPLY', 'APPLY', 'DUPLICATE']);
  assert.deepEqual(gaps, [{ key: `${org}/check/${a}`, expected: 3, received: 4 }]);
  assert.equal(guard.position(`${org}/check/${a}`), 4);
});

test('no global ordering: independent aggregates never block each other', () => {
  const guard = createOrderingGuard();
  const [a, b] = [randomUUID(), randomUUID()];
  assert.equal(guard.decide(event(a, 1)), 'APPLY');
  assert.equal(guard.decide(event(b, 3)), 'GAP');
  assert.equal(guard.decide(event(a, 2)), 'APPLY');
  assert.equal(guard.decide(event(b, 1)), 'APPLY');
});

test('NONE events dedupe by event ID; PER_BRANCH uses the supplied branch sequence', () => {
  const guard = createOrderingGuard({ maxSeenIds: 2 });
  const once = event(randomUUID(), 7, 'NONE');
  assert.equal(guard.decide(once), 'APPLY');
  assert.equal(guard.decide(once), 'DUPLICATE');
  assert.equal(guard.decide(event(randomUUID(), 7, 'NONE')), 'APPLY');
  const branch = randomUUID();
  assert.equal(guard.decide(event(randomUUID(), 9, 'PER_BRANCH', branch), 1), 'APPLY');
  assert.equal(guard.decide(event(randomUUID(), 1, 'PER_BRANCH', branch), 3), 'GAP');
  assert.equal(orderingKey(event('x', 1, 'PER_BRANCH', branch)), `${org}/branch/${branch}`);
  assert.throws(() => orderingKey(event('x', 1, 'PER_BRANCH', null)), TypeError);
});
