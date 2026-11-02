import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { EventsOutboxTable } from './outbox';

/** Tables owned by shared platform modules. Business contexts add their own interfaces in their modules. */
export interface PlatformDatabase {
  'events.outbox': EventsOutboxTable;
}

export interface DatabaseOptions {
  readonly applicationName: string;
  readonly maxConnections?: number;
  readonly statementTimeoutMs?: number;
}

export interface Database<DB = PlatformDatabase> {
  readonly db: Kysely<DB>;
  close(): Promise<void>;
}

/**
 * Bounded Postgres pool + Kysely instance. Connections open lazily, so creating it never makes
 * process liveness depend on the database.
 */
export function createDatabase<DB = PlatformDatabase>(connectionString: string, options: DatabaseOptions): Database<DB> {
  const max = options.maxConnections ?? 10;
  if (!Number.isInteger(max) || max < 1 || max > 50) throw new TypeError('maxConnections must be 1..50');
  const pool = new Pool({
    connectionString, max, application_name: options.applicationName,
    idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000, statement_timeout: options.statementTimeoutMs ?? 15_000,
  });
  // An idle client error must not crash the process; the next checkout reconnects.
  pool.on('error', () => undefined);
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  let closed = false;
  return Object.freeze({
    db,
    close: async () => { if (!closed) { closed = true; await db.destroy(); } },
  });
}

/** Readiness probe: one bounded round trip. Never throws and never reports connection details. */
export async function checkDatabase<DB>(db: Kysely<DB>, timeoutMs = 2_000): Promise<'ready' | 'unavailable'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const probe = sql<{ ok: number }>`select 1 as ok`.execute(db).then(result => result.rows[0]?.ok === 1);
    const deadline = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); });
    return (await Promise.race([probe, deadline])) ? 'ready' : 'unavailable';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}
