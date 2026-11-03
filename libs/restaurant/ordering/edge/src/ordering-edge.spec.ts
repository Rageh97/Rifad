import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EdgeScopeError, EdgeStoreError, appendLocalEvent, openEdgeStore, pendingCloudSync, pendingLocalDispatch, markLocallyDispatched, markSyncedThrough } from '@rifad/edge-store';
import { EnvelopeError } from '@rifad/events';
import { fixedClock } from '@rifad/kernel';
import { orderingCommands } from '@rifad/ordering-application';
import { ORDERING_EDGE_MIGRATIONS, edgeOrderingUnitOfWork } from './index';

const key = 'a'.repeat(64);
const identity = { organizationId: randomUUID(), branchId: randomUUID() };
const productId = randomUUID();
const clock = fixedClock('2026-11-02T12:00:00.000Z');

test('encrypted Edge check and both round events commit with matching versions and cursors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rifad-ordering-edge-'));
  const path = join(dir, 'checks.db');
  try {
    const store = openEdgeStore({ path, key, environment: 'test', identity, migrations: ORDERING_EDGE_MIGRATIONS });
    try {
      const pricing = { resolve: async () => ({ productId, unitAmount: '12.50', currency: 'EGP', priceListId: null, channel: 'DINE_IN' as const, resolvedAt: clock.now().toISOString() }) };
      const commands = orderingCommands(edgeOrderingUnitOfWork(store), pricing, clock);
      const opened = commands.openCheck({ ...identity, channel: 'DINE_IN', tableRef: 'T1', currency: 'EGP' });
      await commands.addItem(opened.checkId, { productId, quantity: 2 });
      const first = commands.submitRound(opened.checkId);
      await commands.addItem(opened.checkId, { productId, quantity: 1 });
      const second = commands.submitRound(opened.checkId);
      assert.deepEqual(second.rounds.map(round => round.number), [1, 2]);
      assert.deepEqual(pendingLocalDispatch(store).map(event => [event.envelope.eventType, event.envelope.aggregateVersion]), [
        ['restaurant.check.opened.v1', 1], ['restaurant.check_round.submitted.v1', first.version],
        ['restaurant.check_round.submitted.v1', second.version],
      ]);
      assert.deepEqual(pendingCloudSync(store).map(event => event.sequence), [1, 2, 3]);
      markLocallyDispatched(store, 1);
      assert.deepEqual(pendingLocalDispatch(store).map(event => event.sequence), [2, 3]);
      assert.equal(markSyncedThrough(store, 2), 2);
      assert.deepEqual(pendingCloudSync(store).map(event => event.sequence), [3]);
      assert.equal(commands.get(opened.checkId)?.version, second.version);
      assert.throws(() => commands.openCheck({ organizationId: randomUUID(), branchId: identity.branchId, channel: 'TAKEAWAY', currency: 'EGP' }), EdgeScopeError);
    } finally { store.close(); }
    assert.throws(() => openEdgeStore({ path, key: 'b'.repeat(64), environment: 'test', identity, migrations: ORDERING_EDGE_MIGRATIONS }), /EDGE_STORE_UNREADABLE/);
    const reopened = openEdgeStore({ path, key, environment: 'test', identity, migrations: ORDERING_EDGE_MIGRATIONS });
    try { assert.equal(pendingCloudSync(reopened).length, 1); } finally { reopened.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('failed event insert rolls back check state in the same transaction', () => {
  const store = openEdgeStore({ path: ':memory:', environment: 'test', identity, migrations: ORDERING_EDGE_MIGRATIONS });
  try {
    const unit = edgeOrderingUnitOfWork(store);
    const checkId = randomUUID();
    const check = { checkId, ...identity, channel: 'TAKEAWAY' as const, tableRef: null, currency: 'EGP', status: 'OPEN' as const,
      lines: [], rounds: [], cancellation: null, finalizationId: null, version: 1 };
    const event = { eventType: 'restaurant.check.opened.v1', eventVersion: 1, aggregateId: checkId,
      aggregateVersion: 1, occurredAt: clock.now().toISOString(), payload: { channel: 'TAKEAWAY', tableRef: null } };
    assert.throws(() => unit.run((checks, events) => {
      checks.insert(check);
      events.append(check, [event, event]);
    }), /UNIQUE constraint failed/);
    assert.equal(unit.run(checks => checks.get(checkId)), undefined);
    assert.deepEqual(pendingCloudSync(store), []);
  } finally { store.close(); }
});

test('Edge store requires keys, rejects changed migrations and refuses foreign-scope or Cloud events', () => {
  assert.throws(() => openEdgeStore({ path: ':memory:', environment: 'local', identity }), (error: unknown) => error instanceof EdgeStoreError && error.code === 'EDGE_STORE_KEY_REQUIRED');
  assert.throws(() => openEdgeStore({ path: ':memory:', key: 'invalid', environment: 'test', identity }), (error: unknown) => error instanceof EdgeStoreError && error.code === 'EDGE_STORE_KEY_INVALID');
  const dir = mkdtempSync(join(tmpdir(), 'rifad-edge-migration-'));
  const path = join(dir, 'store.db');
  try {
    const migration = { id: '0101_test', sql: 'CREATE TABLE local_state (id TEXT PRIMARY KEY)' };
    const store = openEdgeStore({ path, key, environment: 'test', identity, migrations: [migration] });
    try {
      const event = { eventId: randomUUID(), eventType: 'restaurant.check.opened.v1', eventVersion: 1,
        plane: 'EDGE' as const, ordering: 'PER_AGGREGATE' as const, organizationId: identity.organizationId, branchId: identity.branchId,
        aggregateType: 'check', aggregateId: randomUUID(), aggregateVersion: 1, occurredAt: clock.now().toISOString(),
        correlationId: randomUUID(), causationId: null, idempotencyKey: randomUUID(), payload: { channel: 'TAKEAWAY', tableRef: null } };
      assert.throws(() => appendLocalEvent(store, { ...event, organizationId: randomUUID() }), EdgeScopeError);
      assert.throws(() => appendLocalEvent(store, { ...event, branchId: randomUUID() }), EdgeScopeError);
      assert.throws(() => appendLocalEvent(store, { ...event, plane: 'CLOUD' }), EnvelopeError);
      appendLocalEvent(store, event);
      assert.throws(() => appendLocalEvent(store, { ...event, eventId: randomUUID() }), /UNIQUE constraint failed/);
      assert.equal(pendingCloudSync(store).length, 1);
    } finally { store.close(); }
    assert.throws(() => openEdgeStore({ path, key, environment: 'test', identity, migrations: [{ ...migration, sql: 'CREATE TABLE local_state (id INTEGER)' }] }),
      (error: unknown) => error instanceof EdgeStoreError && error.code === 'EDGE_MIGRATION_CHECKSUM_MISMATCH');
    assert.throws(() => openEdgeStore({ path, key, environment: 'test', identity }),
      (error: unknown) => error instanceof EdgeStoreError && error.code === 'EDGE_MIGRATION_UNKNOWN_APPLIED');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
