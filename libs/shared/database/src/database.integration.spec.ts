import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { sql, type Kysely } from 'kysely';
import { Client } from 'pg';
import { EnvelopeError, type EventEnvelope } from '@rifad/events';
import {
  InboxError, MIGRATIONS, MigrationError, OWNER_ROLE, RELAY_ROLE, RUNTIME_ROLE, TenantContextError, appendToOutbox, auditRuntimeRole, auditTenantTables,
  receiveOperation, sequenceGaps,
  checkDatabase, createDatabase, migrate, withTransaction, type Database, type PlatformDatabase,
} from './index';
import { startPostgres, type PostgresServer } from '@rifad/test-containers';

/** Synthetic Cloud-owned business table used only to prove business change + outbox atomicity. */
interface FixtureDatabase extends PlatformDatabase {
  'fixture.settings': { organization_id: string; key: string; value: string };
}

let server: PostgresServer;
let owner: Database<FixtureDatabase>;
let app: Database<FixtureDatabase>;
let firstRun: string[];
const orgA = randomUUID();
const orgB = randomUUID();

function envelope(organizationId: string, overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: randomUUID(), eventType: 'platform.setting_changed.v1', eventVersion: 1, plane: 'CLOUD', ordering: 'PER_AGGREGATE',
    organizationId, branchId: null, aggregateType: 'organization_setting', aggregateId: randomUUID(), aggregateVersion: 1,
    occurredAt: '2026-11-02T10:00:00.000Z', correlationId: 'it-' + randomUUID().slice(0, 8), causationId: null,
    idempotencyKey: 'key-' + randomUUID(), payload: { key: 'timezone' }, ...overrides,
  };
}

async function pgError(promise: Promise<unknown>): Promise<string> {
  try { await promise; return 'NO_ERROR'; }
  catch (error) { return String((error as { code?: unknown }).code ?? (error as Error).name); }
}

const count = (db: Kysely<FixtureDatabase>, table: 'events.outbox' | 'fixture.settings') =>
  db.selectFrom(table).select(eb => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow().then(row => Number(row.n));

before(async () => {
  server = await startPostgres();
  owner = createDatabase<FixtureDatabase>(server.ownerUrl, { applicationName: 'rifad-it-owner', maxConnections: 2 });
  firstRun = await migrate(owner.db);
  await sql.raw(`
    CREATE SCHEMA fixture;
    GRANT USAGE ON SCHEMA fixture TO ${RUNTIME_ROLE};
    CREATE TABLE fixture.settings (organization_id uuid NOT NULL, key text NOT NULL, value text NOT NULL, PRIMARY KEY (organization_id, key));
    ALTER TABLE fixture.settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fixture.settings FORCE ROW LEVEL SECURITY;
    CREATE POLICY settings_tenant ON fixture.settings USING (organization_id = rifad.current_organization_id()) WITH CHECK (organization_id = rifad.current_organization_id());
    GRANT SELECT, INSERT ON fixture.settings TO ${RUNTIME_ROLE};`).execute(owner.db);
  // One pooled connection makes context leakage between transactions observable.
  app = createDatabase<FixtureDatabase>(server.appUrl, { applicationName: 'rifad-it-app', maxConnections: 1 });
}, { timeout: 360_000 });

after(async () => {
  await app?.close();
  await owner?.close();
  await server?.stop();
});

test('fresh database migrates in order and re-running is a no-op', async () => {
  assert.deepEqual(firstRun, MIGRATIONS.map(migration => migration.id));
  assert.deepEqual(await migrate(owner.db), []);
  const rows = await sql<{ id: string; owner: string }>`select id, owner from rifad_meta.schema_migrations order by id`.execute(owner.db);
  assert.deepEqual(rows.rows, MIGRATIONS.map(({ id, owner: module }) => ({ id, owner: module })));
});

test('concurrent runs apply once; edited, removed or unordered migrations fail', async () => {
  const admin = new Client({ connectionString: server.adminUrl });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE rifad_scratch OWNER ${OWNER_ROLE}`); } finally { await admin.end(); }
  const scratch = createDatabase(server.ownerUrl.replace(/\/rifad$/, '/rifad_scratch'), { applicationName: 'rifad-it-scratch', maxConnections: 4 });
  try {
    const [left, right] = await Promise.all([migrate(scratch.db), migrate(scratch.db)]);
    assert.deepEqual([...left, ...right].sort(), MIGRATIONS.map(migration => migration.id));
    const edited = MIGRATIONS.map((migration, index) => index === 0 ? { ...migration, sql: migration.sql + '\n-- edited' } : migration);
    assert.equal(((await migrate(scratch.db, edited).catch(error => error)) as MigrationError).code, 'MIGRATION_CHECKSUM_MISMATCH');
    assert.equal(((await migrate(scratch.db, MIGRATIONS.slice(0, 1)).catch(error => error)) as MigrationError).code, 'MIGRATION_UNKNOWN_APPLIED');
    assert.equal(((await migrate(scratch.db, [...MIGRATIONS].reverse()).catch(error => error)) as MigrationError).code, 'MIGRATION_INVALID');
    // The audit itself must catch a tenant table created without RLS.
    await sql`CREATE TABLE public.unsafe (organization_id uuid NOT NULL)`.execute(scratch.db);
    assert.deepEqual((await auditTenantTables(scratch.db)).map(violation => violation.problem).sort(), ['NO_POLICY', 'RLS_DISABLED', 'RLS_NOT_FORCED']);
    // ...and an all-rows policy that is not limited to the approved relay role.
    await sql`ALTER TABLE public.unsafe ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY`.execute(scratch.db);
    await sql.raw(`CREATE POLICY open_all ON public.unsafe USING (true); CREATE POLICY open_app ON events.outbox FOR SELECT TO ${RUNTIME_ROLE} USING (true)`).execute(scratch.db);
    assert.deepEqual((await auditTenantTables(scratch.db)).map(violation => violation.table + ':' + violation.problem).sort(), ['events.outbox:UNSCOPED_ALL_ROWS_POLICY', 'public.unsafe:UNSCOPED_ALL_ROWS_POLICY']);
  } finally { await scratch.close(); }
});

test('every tenant-owned table has forced RLS from creation and the runtime role cannot bypass it', async () => {
  assert.deepEqual(await auditTenantTables(owner.db), []);
  assert.deepEqual(await auditRuntimeRole(owner.db), []);
  assert.deepEqual(await auditRuntimeRole(owner.db, RELAY_ROLE), []);
  const tables = await sql<{ table: string }>`select n.nspname || '.' || c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relrowsecurity order by 1`.execute(owner.db);
  assert.deepEqual(tables.rows.map(row => row.table), ['events.consumer_position', 'events.consumer_processed', 'events.outbox', 'fixture.settings', 'sync.inbox']);
});

test('tenant context isolates reads and writes; missing context denies by default', async () => {
  await withTransaction(app.db, { organizationId: orgA }, trx => appendToOutbox(trx, envelope(orgA)));
  assert.equal(await withTransaction(app.db, { organizationId: orgA }, trx => count(trx, 'events.outbox')), 1);
  assert.equal(await withTransaction(app.db, { organizationId: orgB }, trx => count(trx, 'events.outbox')), 0);
  assert.equal(await withTransaction(app.db, 'platform', trx => count(trx, 'events.outbox')), 0);
  assert.equal(await count(app.db, 'events.outbox'), 0);
  // Writing another tenant's row, or any row without context, violates the RLS WITH CHECK policy.
  assert.equal(await pgError(withTransaction(app.db, { organizationId: orgA }, trx => appendToOutbox(trx, envelope(orgB)))), '42501');
  assert.equal(await pgError(withTransaction(app.db, 'platform', trx => appendToOutbox(trx, envelope(orgA)))), '42501');
  assert.equal(await pgError(appendToOutbox(app.db, envelope(orgA))), '42501');
  // Published events are immutable to the runtime role; it has no UPDATE/DELETE, DDL or metadata access.
  for (const statement of [
    sql`update events.outbox set status = 'PUBLISHED'`, sql`delete from events.outbox`, sql`select * from rifad_meta.schema_migrations`,
    sql`create table events.rogue (id int)`, sql`create table public.rogue (id int)`, sql`alter table events.outbox disable row level security`,
  ]) {
    assert.equal(await pgError(withTransaction(app.db, { organizationId: orgA }, trx => statement.execute(trx))), '42501');
  }
  assert.equal(await withTransaction(app.db, { organizationId: orgA }, trx => count(trx, 'events.outbox')), 1);
});

test('transaction-local tenant context never leaks to the next pooled transaction', async () => {
  await withTransaction(app.db, { organizationId: orgA }, async trx => {
    assert.equal((await sql<{ org: string }>`select rifad.current_organization_id()::text as org`.execute(trx)).rows[0]?.org, orgA);
  });
  const next = await sql<{ org: string | null }>`select rifad.current_organization_id()::text as org`.execute(app.db);
  assert.equal(next.rows[0]?.org, null);
  await assert.rejects(withTransaction(app.db, { organizationId: 'not-a-uuid' }, async () => 1), TenantContextError);
});

test('business change and outbox event commit or roll back together', async () => {
  const before = await withTransaction(app.db, { organizationId: orgB }, trx => count(trx, 'events.outbox'));
  await assert.rejects(withTransaction(app.db, { organizationId: orgB }, async trx => {
    await trx.insertInto('fixture.settings').values({ organization_id: orgB, key: 'timezone', value: 'Asia/Riyadh' }).execute();
    await appendToOutbox(trx, envelope(orgB));
    throw new Error('simulated failure after both writes');
  }), /simulated failure/);
  assert.equal(await withTransaction(app.db, { organizationId: orgB }, trx => count(trx, 'fixture.settings')), 0);
  assert.equal(await withTransaction(app.db, { organizationId: orgB }, trx => count(trx, 'events.outbox')), before);
  await withTransaction(app.db, { organizationId: orgB }, async trx => {
    await trx.insertInto('fixture.settings').values({ organization_id: orgB, key: 'timezone', value: 'Asia/Riyadh' }).execute();
    await appendToOutbox(trx, envelope(orgB));
  });
  assert.equal(await withTransaction(app.db, { organizationId: orgB }, trx => count(trx, 'fixture.settings')), 1);
  assert.equal(await withTransaction(app.db, { organizationId: orgB }, trx => count(trx, 'events.outbox')), before + 1);
});

test('outbox enforces idempotency, per-aggregate version uniqueness and Cloud-only planes', async () => {
  const first = envelope(orgA);
  await withTransaction(app.db, { organizationId: orgA }, trx => appendToOutbox(trx, first));
  assert.equal(await pgError(withTransaction(app.db, { organizationId: orgA }, trx => appendToOutbox(trx, { ...first, eventId: randomUUID() }))), '23505');
  assert.equal(await pgError(withTransaction(app.db, { organizationId: orgA }, trx => appendToOutbox(trx, { ...first, eventId: randomUUID(), idempotencyKey: 'other-' + randomUUID() }))), '23505');
  await assert.rejects(withTransaction(app.db, { organizationId: orgA }, trx => appendToOutbox(trx, envelope(orgA, { plane: 'EDGE' }))), EnvelopeError);
  await assert.rejects(withTransaction(app.db, { organizationId: orgA }, trx => appendToOutbox(trx, envelope(orgA, { plane: 'EDGE_TO_CLOUD' }))), EnvelopeError);
  const stored = await withTransaction(app.db, { organizationId: orgA }, trx => trx.selectFrom('events.outbox').selectAll().where('event_id', '=', first.eventId).executeTakeFirstOrThrow());
  assert.deepEqual(stored.payload, { key: 'timezone' });
  assert.equal(new Date(stored.occurred_at).toISOString(), first.occurredAt);
});

test('readiness probe reports ready and unavailable without throwing', async () => {
  assert.equal(await checkDatabase(app.db), 'ready');
  const closedPort = await new Promise<number>(done => { const probe = createServer().listen(0, '127.0.0.1', () => { const port = (probe.address() as { port: number }).port; probe.close(() => done(port)); }); });
  const unreachable = createDatabase(`postgres://${RUNTIME_ROLE}:x@127.0.0.1:${closedPort}/rifad`, { applicationName: 'rifad-it-down' });
  try { assert.equal(await checkDatabase(unreachable.db, 3_000), 'unavailable'); } finally { await unreachable.close(); }
});

// The worker also needs its queue; its full readiness and relay run are covered by the outbox-relay suite.
for (const runtime of ['api'] as const) {
  test(`${runtime} reports traffic-ready only with a reachable database`, { timeout: 60_000 }, async () => {
    const port = await new Promise<number>(done => { const probe = createServer().listen(0, '127.0.0.1', () => { const value = (probe.address() as { port: number }).port; probe.close(() => done(value)); }); });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RIFAD_') && !key.startsWith('NODE_TEST') && key !== 'NODE_OPTIONS'));
    const child = fork(resolve('apps', runtime, 'dist/main.js'), [], { env: { ...env, RIFAD_ENV: 'test', NODE_ENV: 'test', RIFAD_PORT: String(port), RIFAD_DATABASE_URL: server.appUrl }, silent: true, execArgv: [] });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { output += chunk; });
    try {
      let response: Response | undefined;
      for (const deadline = Date.now() + 20_000; Date.now() < deadline;) {
        try { response = await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(2_000) }); break; }
        catch { await new Promise(done => setTimeout(done, 100)); }
      }
      assert.equal(response?.status, 200, output);
      assert.deepEqual(await response?.json(), { status: 'ready', checks: { database: 'ready' } });
      assert.ok(!output.includes(server.appUrl.split('@')[0]?.split(':')[2] ?? '<none>'), 'database password must not be logged');
    } finally {
      child.send('shutdown');
      await once(child, 'exit');
    }
  });
}

test('db:migrate tool migrates as the owner role and refuses non-loopback servers', async () => {
  const runTool = (url: string) => new Promise<{ code: number | null; output: string }>(done => {
    const child = fork(resolve('tools/db-migrate.mjs'), [], { env: { ...process.env, RIFAD_DATABASE_OWNER_URL: url }, silent: true, execArgv: [] });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { output += chunk; });
    child.on('exit', code => done({ code, output }));
  });
  const applied = await runTool(server.ownerUrl);
  assert.equal(applied.code, 0, applied.output);
  // The shared fixture applies only platform migrations; the tool adds the context-owned ones, once.
  assert.deepEqual(JSON.parse(applied.output.trim()), { event: 'db.migrate.completed', applied: ['0007_organizations_core', '0008_identity_external_identity', '0009_authorization_core', '0010_entitlements_core', '0011_audit_trail'] });
  const again = await runTool(server.ownerUrl);
  assert.equal(again.code, 0, again.output);
  assert.deepEqual(JSON.parse(again.output.trim()), { event: 'db.migrate.completed', applied: [] });
  assert.deepEqual(await auditTenantTables(owner.db), []);
  const refused = await runTool(server.ownerUrl.replace('127.0.0.1', 'db.example.com'));
  assert.equal(refused.code, 1);
  assert.ok(refused.output.includes('INVALID_OWNER_URL') && !refused.output.includes(server.ownerUrl.split('@')[0] ?? '<none>'));
});

interface ProjectionDatabase { 'fixture.projection': { organization_id: string; operation_id: string } }

test('inbox: one Cloud effect per Edge operation, conflicts rejected, gaps observable', async () => {
  await sql.raw(`
    CREATE TABLE fixture.projection (organization_id uuid NOT NULL, operation_id uuid PRIMARY KEY);
    ALTER TABLE fixture.projection ENABLE ROW LEVEL SECURITY; ALTER TABLE fixture.projection FORCE ROW LEVEL SECURITY;
    CREATE POLICY projection_tenant ON fixture.projection USING (organization_id = rifad.current_organization_id()) WITH CHECK (organization_id = rifad.current_organization_id());
    GRANT SELECT, INSERT ON fixture.projection TO ${RUNTIME_ROLE};`).execute(owner.db);
  const source = randomUUID();
  const operation = (sequence: number, overrides: Record<string, unknown> = {}) => ({ organizationId: orgA, sourceId: source, operationId: randomUUID(), sourceSequence: sequence, operationType: 'restaurant.check_round.submitted', payload: { round: sequence, lines: [{ b: 2, a: 1 }] }, ...overrides });
  const deliver = (op: ReturnType<typeof operation>) => withTransaction(app.db as unknown as Kysely<ProjectionDatabase>, { organizationId: orgA }, trx =>
    receiveOperation(trx, op, async () => { await trx.insertInto('fixture.projection').values({ organization_id: orgA, operation_id: op.operationId }).execute(); }));
  const first = operation(1);
  assert.equal(await deliver(first), 'APPLIED');
  assert.equal(await deliver({ ...first, payload: { lines: [{ a: 1, b: 2 }], round: 1 } }), 'DUPLICATE');
  assert.equal(await deliver(operation(2)), 'APPLIED');
  assert.equal(await deliver(operation(5)), 'APPLIED_WITH_GAP');
  const projected = await withTransaction(app.db as unknown as Kysely<ProjectionDatabase>, { organizationId: orgA }, trx => trx.selectFrom('fixture.projection').select('operation_id').execute());
  assert.equal(projected.length, 3);
  assert.deepEqual(await withTransaction(app.db, { organizationId: orgA }, trx => sequenceGaps(trx, orgA, source)), [{ from: 3, to: 4 }]);
  const conflict = async (op: ReturnType<typeof operation>) => { const error = await deliver(op).catch(caught => caught); return error instanceof InboxError ? error.code : 'NO_ERROR'; };
  assert.equal(await conflict({ ...first, payload: { round: 99, lines: [] } }), 'INBOX_OPERATION_CONFLICT');
  assert.equal(await conflict(operation(2)), 'INBOX_SEQUENCE_CONFLICT');
  assert.equal(await conflict(operation(0)), 'INBOX_INVALID_OPERATION');
  // A failed projection effect rolls back the inbox row, so redelivery is applied later rather than lost.
  const late = operation(3);
  await assert.rejects(withTransaction(app.db, { organizationId: orgA }, trx => receiveOperation(trx, late, async () => { throw new Error('projection failed'); })), /projection failed/);
  assert.equal(await deliver(late), 'APPLIED');
  assert.deepEqual(await withTransaction(app.db, { organizationId: orgA }, trx => sequenceGaps(trx, orgA, source)), [{ from: 4, to: 4 }]);
  // Tenant isolation holds for the inbox as well.
  assert.deepEqual(await withTransaction(app.db, { organizationId: orgB }, trx => sequenceGaps(trx, orgB, source)), []);
  assert.equal(await withTransaction(app.db, { organizationId: orgB }, trx => sql<{ n: string }>`select count(*) as n from sync.inbox`.execute(trx)).then(result => Number(result.rows[0]?.n)), 0);
});
