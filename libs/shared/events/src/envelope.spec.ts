import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { EnvelopeError, MAX_PAYLOAD_BYTES, validateEnvelope, type EventEnvelope } from './index';

function sampleEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: randomUUID(), eventType: 'platform.config_changed.v1', eventVersion: 1, plane: 'CLOUD', ordering: 'PER_AGGREGATE',
    organizationId: randomUUID(), branchId: null, aggregateType: 'organization_setting', aggregateId: randomUUID(), aggregateVersion: 1,
    occurredAt: '2026-11-02T10:00:00.000Z', correlationId: 'corr-1', causationId: null, idempotencyKey: 'setting:1', payload: { key: 'timezone' },
    ...overrides,
  };
}

const field = (overrides: Record<string, unknown>) => {
  try { validateEnvelope(sampleEnvelope(overrides as Partial<EventEnvelope>)); return 'VALID'; }
  catch (error) { return error instanceof EnvelopeError ? error.field : 'OTHER'; }
};

test('valid envelopes are copied and frozen', () => {
  const input = sampleEnvelope();
  const output = validateEnvelope(input);
  assert.deepEqual(output, input);
  assert.ok(Object.isFrozen(output));
  assert.notEqual(output.payload, input.payload);
  assert.equal(field({ plane: 'EDGE', ordering: 'PER_BRANCH', branchId: randomUUID() }), 'VALID');
});

test('each field is validated', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ eventId: 'not-uuid' }, 'eventId'],
    [{ eventType: 'ConfigChanged' }, 'eventType'],
    [{ eventVersion: 2 }, 'eventVersion'],
    [{ plane: 'QUEUE' }, 'plane'],
    [{ ordering: 'GLOBAL' }, 'ordering'],
    [{ organizationId: '' }, 'organizationId'],
    [{ branchId: 'x' }, 'branchId'],
    [{ ordering: 'PER_BRANCH', branchId: null }, 'branchId'],
    [{ aggregateType: 'Check' }, 'aggregateType'],
    [{ aggregateId: 'x' }, 'aggregateId'],
    [{ aggregateVersion: 0 }, 'aggregateVersion'],
    [{ aggregateVersion: 1.5 }, 'aggregateVersion'],
    [{ occurredAt: '2026-11-02T13:00:00+03:00' }, 'occurredAt'],
    [{ occurredAt: '2026-13-40T00:00:00Z' }, 'occurredAt'],
    [{ correlationId: 'bad id' }, 'correlationId'],
    [{ causationId: 'x' }, 'causationId'],
    [{ idempotencyKey: '' }, 'idempotencyKey'],
    [{ payload: undefined }, 'payload'],
    [{ payload: { big: 'x'.repeat(MAX_PAYLOAD_BYTES) } }, 'payload'],
    [{ payload: { n: 1n } }, 'payload'],
  ];
  for (const [overrides, expected] of cases) assert.equal(field(overrides), expected, JSON.stringify(Object.keys(overrides)));
});

test('errors name the field without echoing values', () => {
  const canary = ['synthetic', 'value'].join('-');
  try { validateEnvelope(sampleEnvelope({ correlationId: canary + ' x' })); assert.fail('must reject'); }
  catch (error) { assert.ok(!String(error).includes(canary)); }
});
