import { createHash } from 'node:crypto';
import Database from 'better-sqlite3-multiple-ciphers';

export type EdgeDatabase = Database.Database;

export interface EdgeIdentity {
  /** The single tenant and branch this Edge device serves (ADR-029/037). */
  readonly organizationId: string;
  readonly branchId: string;
}

export interface EdgeStoreOptions {
  readonly path: string;
  /** 32-byte key as 64 hex characters. Key custody, rotation and recovery are decision G08. */
  readonly key?: string;
  /** Only `test` may open an unencrypted store, and only for `:memory:` or explicit test files. */
  readonly environment: 'local' | 'test';
  readonly identity: EdgeIdentity;
  /** Context-owned Edge migrations (e.g. Ordering), applied after the store's own, in ID order. */
  readonly migrations?: readonly EdgeMigration[];
}

export interface EdgeStore {
  readonly db: EdgeDatabase;
  readonly identity: EdgeIdentity;
  readonly encrypted: boolean;
  close(): void;
}

export class EdgeStoreError extends Error {
  constructor(readonly code: 'EDGE_STORE_KEY_REQUIRED' | 'EDGE_STORE_KEY_INVALID' | 'EDGE_STORE_UNREADABLE' | 'EDGE_MIGRATION_CHECKSUM_MISMATCH' | 'EDGE_MIGRATION_UNKNOWN_APPLIED') {
    super(code);
    this.name = 'EdgeStoreError';
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Opens the Edge SQLite store (ADR-006, E02): SQLCipher encryption, WAL, full synchronous commits,
 * foreign keys and a bounded busy timeout. The database file is reached only through the Edge
 * API process, never shared over the network (§21). A wrong key fails before any use.
 */
export function openEdgeStore(options: EdgeStoreOptions): EdgeStore {
  if (!uuid.test(options.identity.organizationId) || !uuid.test(options.identity.branchId)) throw new TypeError('Edge identity must be UUIDs');
  if (options.key === undefined && options.environment !== 'test') throw new EdgeStoreError('EDGE_STORE_KEY_REQUIRED');
  if (options.key !== undefined && !/^[0-9a-f]{64}$/i.test(options.key)) throw new EdgeStoreError('EDGE_STORE_KEY_INVALID');
  const db = new Database(options.path, { timeout: 5_000 });
  try {
    if (options.key !== undefined) {
      db.pragma(`cipher='sqlcipher'`);
      // Raw key form; the value is validated hex above, so it cannot inject SQL.
      db.pragma(`key="x'${options.key}'"`);
    }
    try { db.prepare('select count(*) from sqlite_master').get(); }
    catch { throw new EdgeStoreError('EDGE_STORE_UNREADABLE'); }
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('foreign_keys = ON');
    migrateEdge(db, [...EDGE_MIGRATIONS, ...(options.migrations ?? [])]);
  } catch (error) {
    db.close();
    throw error;
  }
  return Object.freeze({ db, identity: Object.freeze({ ...options.identity }), encrypted: options.key !== undefined, close: () => db.close() });
}

export interface EdgeMigration {
  readonly id: string;
  readonly sql: string;
}

/** Edge schema migrations; immutable once shipped, applied in order in one transaction. */
export const EDGE_MIGRATIONS: readonly EdgeMigration[] = Object.freeze([
  {
    id: '0001_local_outbox',
    sql: `
      CREATE TABLE local_outbox (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        organization_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_version INTEGER NOT NULL CHECK (event_version > 0),
        plane TEXT NOT NULL CHECK (plane IN ('EDGE', 'EDGE_TO_CLOUD')),
        ordering TEXT NOT NULL CHECK (ordering IN ('NONE', 'PER_AGGREGATE', 'PER_BRANCH')),
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_version INTEGER NOT NULL CHECK (aggregate_version > 0),
        occurred_at TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        causation_id TEXT,
        idempotency_key TEXT NOT NULL,
        payload TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        dispatched_at TEXT,
        synced_at TEXT,
        UNIQUE (organization_id, idempotency_key),
        UNIQUE (aggregate_type, aggregate_id, aggregate_version)
      );
      CREATE INDEX local_outbox_dispatch ON local_outbox (sequence) WHERE dispatched_at IS NULL AND plane = 'EDGE';
      CREATE INDEX local_outbox_sync ON local_outbox (sequence) WHERE synced_at IS NULL;
    `,
  },
  {
    id: '0002_local_consumer_state',
    sql: `
      CREATE TABLE local_consumer_processed (
        consumer TEXT NOT NULL,
        event_id TEXT NOT NULL,
        processed_at TEXT NOT NULL,
        PRIMARY KEY (consumer, event_id)
      );
      CREATE TABLE local_consumer_position (
        consumer TEXT NOT NULL,
        ordering_key TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position > 0),
        PRIMARY KEY (consumer, ordering_key)
      );
    `,
  },
]);

const checksum = (migration: EdgeMigration) => createHash('sha256').update(migration.id + '\n' + migration.sql).digest('hex');

/** Same rules as the Cloud migrator: re-runs are no-ops; edited or removed migrations fail. */
export function migrateEdge(db: EdgeDatabase, migrations: readonly EdgeMigration[]): string[] {
  return db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS edge_schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const applied = new Map((db.prepare('select id, checksum from edge_schema_migrations').all() as { id: string; checksum: string }[]).map(row => [row.id, row.checksum]));
    const ids = new Set(migrations.map(migration => migration.id));
    for (const id of applied.keys()) if (!ids.has(id)) throw new EdgeStoreError('EDGE_MIGRATION_UNKNOWN_APPLIED');
    const newly: string[] = [];
    for (const migration of migrations) {
      const known = applied.get(migration.id);
      if (known !== undefined) {
        if (known !== checksum(migration)) throw new EdgeStoreError('EDGE_MIGRATION_CHECKSUM_MISMATCH');
        continue;
      }
      db.exec(migration.sql);
      db.prepare('insert into edge_schema_migrations (id, checksum, applied_at) values (?, ?, ?)').run(migration.id, checksum(migration), new Date().toISOString());
      newly.push(migration.id);
    }
    return newly;
  }).immediate();
}
