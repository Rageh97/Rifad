import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { sql } from 'kysely';
import type { Queue } from 'bullmq';
import { appendToOutbox, createDatabase, migrate, withTransaction, type Database } from '@rifad/database';
import type { EventEnvelope } from '@rifad/events';
import { checkQueue, createEventQueue } from '@rifad/queue';
import { startPostgres, startRedis, type PostgresServer, type RedisServer } from '@rifad/test-containers';
import { relayOnce } from './index';

let postgres: PostgresServer;
let redis: RedisServer;
let owner: Database;
let app: Database;
let relayDb: Database;
let queue: Queue;
const org = randomUUID();

function envelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: randomUUID(), eventType: 'platform.setting_changed.v1', eventVersion: 1, plane: 'CLOUD', ordering: 'PER_AGGREGATE',
    organizationId: org, branchId: null, aggregateType: 'organization_setting', aggregateId: randomUUID(), aggregateVersion: 1,
    occurredAt: '2026-11-02T10:00:00.000Z', correlationId: 'relay-it', causationId: null, idempotencyKey: 'k-' + randomUUID(), payload: { key: 'timezone' },
    ...overrides,
  };
}

async function append(count: number): Promise<string[]> {
  const events = Array.from({ length: count }, () => envelope());
  await withTransaction(app.db, { organizationId: org }, async trx => { for (const event of events) await appendToOutbox(trx, event); });
  return events.map(event => event.eventId);
}

const states = async (ids: string[]) => (await sql<{ event_id: string; status: string; attempts: number; last_error: string | null }>`
  select event_id, status, attempts, last_error from events.outbox where event_id = any(${ids}::uuid[]) order by event_id`.execute(owner.db)).rows;

async function pgError(promise: Promise<unknown>): Promise<string> {
  try { await promise; return 'NO_ERROR'; } catch (error) { return String((error as { code?: unknown }).code ?? (error as Error).name); }
}

before(async () => {
  [postgres, redis] = await Promise.all([startPostgres(), startRedis()]);
  owner = createDatabase(postgres.ownerUrl, { applicationName: 'relay-it-owner', maxConnections: 2 });
  await migrate(owner.db);
  // The owner sees every row only for assertions: FORCE RLS applies to it too, so it reads via a policy-free path.
  await sql.raw(`CREATE POLICY outbox_owner_assertions ON events.outbox FOR SELECT TO rifad_owner USING (true)`).execute(owner.db);
  app = createDatabase(postgres.appUrl, { applicationName: 'relay-it-app', maxConnections: 2 });
  relayDb = createDatabase(postgres.relayUrl, { applicationName: 'relay-it-relay', maxConnections: 4 });
  queue = createEventQueue({ url: redis.url });
  queue.on('error', () => undefined);
}, { timeout: 420_000 });

/** Bounded wait: a queue client still reconnecting must not hang teardown. */
const bounded = (promise: Promise<unknown> | undefined, ms = 5_000) => Promise.race([promise?.catch(() => undefined), new Promise(done => setTimeout(done, ms))]);

after(async () => {
  await bounded(queue?.close());
  await Promise.all([app?.close(), relayDb?.close(), owner?.close()]);
  await Promise.all([postgres?.stop(), redis?.stop()]);
});

beforeEach(async () => {
  // After a Redis restart the client may still be reconnecting; commands fail fast until it is back.
  for (const deadline = Date.now() + 15_000; ;) {
    try { await queue.obliterate({ force: true }); break; }
    catch (error) { if (Date.now() > deadline) throw error; await new Promise(done => setTimeout(done, 250)); }
  }
  await sql`update events.outbox set status = 'PUBLISHED' where status <> 'PUBLISHED'`.execute(relayDb.db);
});

test('pending events publish once with jobId = eventId and are marked PUBLISHED', async () => {
  const ids = await append(3);
  const result = await relayOnce(relayDb.db, queue);
  assert.deepEqual(result, { claimed: 3, published: 3, retried: 0, failed: 0 });
  assert.deepEqual((await states(ids)).map(row => [row.status, row.attempts]), [['PUBLISHED', 1], ['PUBLISHED', 1], ['PUBLISHED', 1]]);
  for (const id of ids) {
    const job = await queue.getJob(id);
    assert.equal(job?.id, id);
    assert.equal((job?.data as EventEnvelope).eventId, id);
    assert.equal((job?.data as EventEnvelope).organizationId, org);
  }
  assert.deepEqual(await relayOnce(relayDb.db, queue), { claimed: 0, published: 0, retried: 0, failed: 0 });
});

test('relay role is scoped: no inserts, deletes, payload edits or access to other tables', async () => {
  const [id] = await append(1);
  for (const statement of [
    sql`insert into events.outbox (event_id) values (${randomUUID()})`, sql`delete from events.outbox`,
    sql`update events.outbox set payload = '{}'::jsonb where event_id = ${id}`, sql`update events.outbox set organization_id = ${randomUUID()}`,
    sql`select * from sync.inbox`, sql`select * from rifad_meta.schema_migrations`,
  ]) {
    assert.equal(await pgError(statement.execute(relayDb.db)), '42501');
  }
  // The runtime role still cannot see other tenants' rows or change publish state.
  assert.equal(await pgError(sql`update events.outbox set status = 'PUBLISHED'`.execute(app.db)), '42501');
});

test('a crash after publishing but before commit loses nothing and does not duplicate the job', async () => {
  const ids = await append(2);
  await assert.rejects(relayOnce(relayDb.db, queue, { afterPublish: () => { throw new Error('simulated crash'); } }), /simulated crash/);
  assert.deepEqual((await states(ids)).map(row => row.status), ['PENDING', 'PENDING']);
  // Rows from one transaction share recorded_at and are claimed in event_id order: exactly one was published before the crash.
  assert.equal((await Promise.all(ids.map(id => queue.getJob(id)))).filter(Boolean).length, 1);
  assert.equal((await relayOnce(relayDb.db, queue)).published, 2);
  assert.deepEqual((await states(ids)).map(row => row.status), ['PUBLISHED', 'PUBLISHED']);
  assert.equal(await queue.count(), 2);
});

test('Redis outage keeps events pending with backoff; restart publishes them and keeps earlier jobs', async () => {
  const [earlier] = await append(1);
  assert.equal((await relayOnce(relayDb.db, queue)).published, 1);
  const ids = await append(2);
  await redis.down();
  try {
    assert.equal(await checkQueue({ url: redis.url }), 'unavailable');
    const result = await relayOnce(relayDb.db, queue, { publishTimeoutMs: 1_000, retryBaseMs: 200 });
    assert.deepEqual([result.published, result.retried], [0, 1]);
    const rows = await states(ids);
    assert.deepEqual(rows.map(row => [row.status, row.last_error]).sort(), [['PENDING', null], ['PENDING', 'QUEUE_UNAVAILABLE']]);
  } finally {
    await redis.up();
  }
  await new Promise(done => setTimeout(done, 300));
  for (let pass = 0; pass < 60 && (await states(ids)).some(row => row.status !== 'PUBLISHED'); pass++) {
    await relayOnce(relayDb.db, queue, { publishTimeoutMs: 2_000 }).catch(() => undefined);
    await new Promise(done => setTimeout(done, 250));
  }
  assert.deepEqual((await states(ids)).map(row => row.status), ['PUBLISHED', 'PUBLISHED']);
  assert.ok(await queue.getJob(earlier ?? ''), 'append-only queue data survived the restart');
  assert.equal(await checkQueue({ url: redis.url }), 'ready');
});

test('exhausted attempts mark FAILED for operators instead of retrying forever', async () => {
  const [id] = await append(1);
  await redis.down();
  try {
    const result = await relayOnce(relayDb.db, queue, { maxAttempts: 1, publishTimeoutMs: 1_000 });
    assert.equal(result.failed, 1);
  } finally { await redis.up(); }
  assert.deepEqual((await states([id ?? ''])).map(row => [row.status, row.last_error]), [['FAILED', 'QUEUE_UNAVAILABLE']]);
  assert.equal((await relayOnce(relayDb.db, queue)).claimed, 0);
});

test('concurrent relays never claim the same row twice', async () => {
  const ids = await append(30);
  const results = await Promise.all([relayOnce(relayDb.db, queue, { batchSize: 10 }), relayOnce(relayDb.db, queue, { batchSize: 10 }), relayOnce(relayDb.db, queue, { batchSize: 10 })]);
  assert.equal(results.reduce((sum, result) => sum + result.claimed, 0), 30);
  assert.equal(results.reduce((sum, result) => sum + result.published, 0), 30);
  assert.ok((await states(ids)).every(row => row.status === 'PUBLISHED' && row.attempts === 1));
  assert.equal(await queue.count(), 30);
});

test('queue readiness requires noeviction', async () => {
  assert.equal(await checkQueue({ url: redis.url }), 'ready');
  const evicting = await startRedis({ misconfigured: true });
  try { assert.equal(await checkQueue({ url: evicting.url }), 'misconfigured'); } finally { await evicting.stop(); }
});

test('worker is traffic-ready with database and queue and relays appended events end to end', { timeout: 90_000 }, async () => {
  const port = await new Promise<number>(done => { const probe = createServer().listen(0, '127.0.0.1', () => { const value = (probe.address() as { port: number }).port; probe.close(() => done(value)); }); });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RIFAD_') && !key.startsWith('NODE_TEST') && key !== 'NODE_OPTIONS'));
  // Clean execArgv and no test-runner variables: the app must start exactly as in production.
  const child = fork(resolve('apps/worker/dist/main.js'), [], { silent: true, execArgv: [], env: {
    ...env, RIFAD_ENV: 'test', NODE_ENV: 'test', RIFAD_PORT: String(port),
    RIFAD_DATABASE_URL: postgres.appUrl, RIFAD_RELAY_DATABASE_URL: postgres.relayUrl, RIFAD_QUEUE_REDIS_URL: redis.url,
  } });
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk; });
  child.stderr?.on('data', chunk => { output += chunk; });
  try {
    let ready: Response | undefined;
    for (const deadline = Date.now() + 20_000; Date.now() < deadline && ready?.status !== 200;) {
      ready = await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(3_000) }).catch(() => undefined);
      if (ready?.status !== 200) await new Promise(done => setTimeout(done, 200));
    }
    assert.equal(ready?.status, 200, output);
    assert.deepEqual(await ready?.json(), { status: 'ready', checks: { database: 'ready', queue: 'ready' } });
    const ids = await append(2);
    for (const deadline = Date.now() + 15_000; Date.now() < deadline && (await states(ids)).some(row => row.status !== 'PUBLISHED');) {
      await new Promise(done => setTimeout(done, 200));
    }
    assert.deepEqual((await states(ids)).map(row => row.status), ['PUBLISHED', 'PUBLISHED'], output);
    for (const id of ids) assert.ok(await queue.getJob(id));
    const lines = output.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(lines.some(line => line.event === 'outbox.relay.pass' && line.published >= 1));
    for (const url of [postgres.appUrl, postgres.relayUrl, redis.url]) assert.ok(!output.includes(new URL(url).password), 'no credential is logged');
  } finally {
    child.send('shutdown');
    await once(child, 'exit');
  }
});
