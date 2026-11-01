import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DomainError, Money, SAR, currency, domainEvent, err, fixedClock, newEntityId, ok, parseEntityId, systemClock } from './index';

const code = (fn: () => unknown) => {
  try { fn(); } catch (error) { return error instanceof DomainError ? error.code : 'NOT_DOMAIN_ERROR'; }
  return 'NO_ERROR';
};

test('entity IDs are generated locally and only canonical UUIDs parse', () => {
  const id = newEntityId<'check'>();
  assert.equal(parseEntityId<'check'>(id), id);
  assert.notEqual(newEntityId(), newEntityId());
  for (const value of ['', 'not-a-uuid', id.toUpperCase(), ' ' + id, '00000000-0000-0000-0000-000000000000', 42, null, undefined]) {
    assert.equal(code(() => parseEntityId(value)), 'INVALID_ENTITY_ID');
  }
});

test('money parses exact decimals and never rounds silently', () => {
  assert.equal(Money.parse('12.50', SAR).minor, 1250n);
  assert.equal(Money.parse('-0.05', SAR).toDecimal(), '-0.05');
  assert.equal(Money.parse('7', SAR).toDecimal(), '7.00');
  assert.equal(Money.parse('999999999999999999.99', SAR).minor, 99999999999999999999n);
  for (const amount of ['12.505', '1e3', '01.00', '', '.5', '1.', ' 1', '1,00', 'NaN', '+1']) {
    assert.equal(code(() => Money.parse(amount, SAR)), 'INVALID_MONEY_AMOUNT', amount);
  }
  const jpy = currency('JPY', 0);
  assert.equal(Money.parse('15', jpy).toDecimal(), '15');
  assert.equal(code(() => Money.parse('15.1', jpy)), 'INVALID_MONEY_AMOUNT');
});

test('money arithmetic is exact, immutable and currency-safe', () => {
  const tenth = Money.parse('0.10', SAR);
  assert.equal(tenth.add(Money.parse('0.20', SAR)).toDecimal(), '0.30');
  assert.equal(tenth.subtract(Money.parse('0.25', SAR)).toDecimal(), '-0.15');
  assert.equal(tenth.times(3).toDecimal(), '0.30');
  assert.equal(tenth.times(3n).negate().isNegative(), true);
  assert.equal(Money.zero(SAR).isZero(), true);
  assert.equal(tenth.compare(Money.parse('0.09', SAR)), 1);
  assert.ok(tenth.equals(Money.ofMinor(10n, SAR)));
  assert.deepEqual(JSON.parse(JSON.stringify(tenth)), { amount: '0.10', currency: 'SAR' });
  assert.ok(Object.isFrozen(tenth));
  const usd = currency('USD', 2);
  assert.equal(code(() => tenth.add(Money.parse('1', usd))), 'CURRENCY_MISMATCH');
  assert.equal(tenth.equals(Money.ofMinor(10n, usd)), false);
  assert.equal(code(() => tenth.times(1.5)), 'INVALID_MONEY_QUANTITY');
  assert.throws(() => currency('sar', 2), TypeError);
  assert.throws(() => currency('SAR', 2.5), TypeError);
});

test('clock is UTC-instant based and deterministic in tests', () => {
  const clock = fixedClock('2026-11-02T08:30:00+03:00');
  assert.equal(clock.now().toISOString(), '2026-11-02T05:30:00.000Z');
  assert.notEqual(clock.now(), clock.now());
  assert.ok(systemClock.now() instanceof Date);
  assert.throws(() => fixedClock('not a date'), TypeError);
});

test('domain errors require stable codes; results are explicit', () => {
  const error = new DomainError('CHECK_ALREADY_CLOSED', 'Check is closed.', 'conflict');
  assert.equal(error.category, 'conflict');
  assert.equal(new DomainError('RULE', 'Rule.').category, 'rule_violation');
  for (const bad of ['lower', 'Mixed_Case', '_LEADING', 'TRAILING_', 'DOUBLE__UNDERSCORE', '']) assert.throws(() => new DomainError(bad, 'x'), TypeError);
  const success = ok(5);
  const failure = err(error);
  assert.ok(success.ok && success.value === 5);
  assert.ok(!failure.ok && failure.error === error);
});

test('domain events carry catalog type, version, aggregate version and UTC time', () => {
  const event = domainEvent({ eventType: 'restaurant.check_round.submitted.v1', aggregateId: 'check-1', aggregateVersion: 2, payload: { round: 2 } }, fixedClock('2026-11-02T00:00:00Z'));
  assert.deepEqual(event, { eventType: 'restaurant.check_round.submitted.v1', eventVersion: 1, aggregateId: 'check-1', aggregateVersion: 2, occurredAt: '2026-11-02T00:00:00.000Z', payload: { round: 2 } });
  assert.ok(Object.isFrozen(event));
  const clock = fixedClock('2026-11-02T00:00:00Z');
  for (const eventType of ['CheckOpened', 'restaurant.check.opened', 'restaurant.v1', 'restaurant.check.opened.v0', 'Restaurant.check.opened.v1']) {
    assert.throws(() => domainEvent({ eventType, aggregateId: 'a', aggregateVersion: 1, payload: null }, clock), TypeError, eventType);
  }
  for (const aggregateVersion of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => domainEvent({ eventType: 'a.b.v1', aggregateId: 'a', aggregateVersion, payload: null }, clock), TypeError);
  }
  assert.throws(() => domainEvent({ eventType: 'a.b.v1', aggregateId: '', aggregateVersion: 1, payload: null }, clock), TypeError);
});
