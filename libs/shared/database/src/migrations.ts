import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';

/** Owner/migration role: owns schemas and tables, runs migrations, never serves requests (§14.1). */
export const OWNER_ROLE = 'rifad_owner';
/** Runtime role granted DML by migrations; it never owns tables and has no BYPASSRLS (§14.1, ADR-043). */
export const RUNTIME_ROLE = 'rifad_app';
/** Scoped service role for the Cloud outbox relay: reads/updates publish state on the outbox only (§14.1). */
export const RELAY_ROLE = 'rifad_relay';

export interface Migration {
  readonly id: string;
  /** Owning module; a module only creates or alters its own tables. */
  readonly owner: string;
  readonly sql: string;
}

/**
 * Deployed migrations are immutable: append new ones, never edit these. Every tenant-owned table
 * enables and forces RLS with a tenant policy in the same migration that creates it.
 */
export const MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    id: '0001_platform_tenant_context',
    owner: 'platform',
    sql: `
      CREATE SCHEMA rifad;
      REVOKE ALL ON SCHEMA rifad FROM PUBLIC;
      GRANT USAGE ON SCHEMA rifad TO ${RUNTIME_ROLE};
      -- Transaction-local tenant context; missing or empty context is NULL, which matches no rows.
      CREATE FUNCTION rifad.current_organization_id() RETURNS uuid
        LANGUAGE sql STABLE PARALLEL SAFE
        AS $$ SELECT NULLIF(current_setting('rifad.organization_id', true), '')::uuid $$;
      REVOKE ALL ON FUNCTION rifad.current_organization_id() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION rifad.current_organization_id() TO ${RUNTIME_ROLE};
    `,
  },
  {
    id: '0002_events_outbox',
    owner: 'events',
    sql: `
      CREATE SCHEMA events;
      REVOKE ALL ON SCHEMA events FROM PUBLIC;
      GRANT USAGE ON SCHEMA events TO ${RUNTIME_ROLE};
      CREATE TABLE events.outbox (
        event_id uuid PRIMARY KEY,
        organization_id uuid NOT NULL,
        branch_id uuid,
        event_type text NOT NULL,
        event_version integer NOT NULL CHECK (event_version > 0),
        plane text NOT NULL CHECK (plane IN ('CLOUD', 'CLOUD_TO_EDGE')),
        ordering text NOT NULL CHECK (ordering IN ('NONE', 'PER_AGGREGATE', 'PER_BRANCH')),
        aggregate_type text NOT NULL,
        aggregate_id uuid NOT NULL,
        aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
        occurred_at timestamptz NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT now(),
        correlation_id text NOT NULL,
        causation_id uuid,
        idempotency_key text NOT NULL,
        payload jsonb NOT NULL,
        status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        available_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT outbox_idempotency UNIQUE (organization_id, idempotency_key),
        CONSTRAINT outbox_aggregate_version UNIQUE (organization_id, aggregate_type, aggregate_id, aggregate_version)
      );
      CREATE INDEX outbox_pending ON events.outbox (available_at) WHERE status = 'PENDING';
      ALTER TABLE events.outbox ENABLE ROW LEVEL SECURITY;
      ALTER TABLE events.outbox FORCE ROW LEVEL SECURITY;
      CREATE POLICY outbox_tenant_isolation ON events.outbox
        USING (organization_id = rifad.current_organization_id())
        WITH CHECK (organization_id = rifad.current_organization_id());
      -- Appending only; publishing state changes belong to the relay worker (M0-021).
      GRANT SELECT, INSERT ON events.outbox TO ${RUNTIME_ROLE};
    `,
  },
  {
    id: '0003_events_outbox_relay',
    owner: 'events',
    sql: `
      ALTER TABLE events.outbox
        ADD COLUMN published_at timestamptz,
        ADD COLUMN last_error text CHECK (last_error ~ '^[A-Z][A-Z0-9_]{0,63}$');
      -- Scoped service role (§14.1): sees every tenant's outbox rows only to publish them, may change
      -- only publish-state columns, and has no access to any other table, INSERT or DELETE.
      GRANT USAGE ON SCHEMA events, rifad TO ${RELAY_ROLE};
      GRANT EXECUTE ON FUNCTION rifad.current_organization_id() TO ${RELAY_ROLE};
      GRANT SELECT ON events.outbox TO ${RELAY_ROLE};
      GRANT UPDATE (status, attempts, available_at, published_at, last_error) ON events.outbox TO ${RELAY_ROLE};
      CREATE POLICY outbox_relay_read ON events.outbox FOR SELECT TO ${RELAY_ROLE} USING (true);
      CREATE POLICY outbox_relay_publish ON events.outbox FOR UPDATE TO ${RELAY_ROLE} USING (true) WITH CHECK (true);
    `,
  },
  {
    id: '0004_sync_inbox',
    owner: 'sync',
    sql: `
      CREATE SCHEMA sync;
      REVOKE ALL ON SCHEMA sync FROM PUBLIC;
      GRANT USAGE ON SCHEMA sync TO ${RUNTIME_ROLE};
      -- Edge -> Cloud operation inbox (M0-022): one row per accepted operation; the payload stays in the
      -- owning context's projection, only its hash is kept to detect conflicting replays.
      CREATE TABLE sync.inbox (
        organization_id uuid NOT NULL,
        source_id uuid NOT NULL,
        operation_id uuid NOT NULL,
        source_sequence bigint NOT NULL CHECK (source_sequence > 0),
        operation_type text NOT NULL,
        payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
        received_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (organization_id, operation_id),
        CONSTRAINT inbox_source_sequence UNIQUE (organization_id, source_id, source_sequence)
      );
      ALTER TABLE sync.inbox ENABLE ROW LEVEL SECURITY;
      ALTER TABLE sync.inbox FORCE ROW LEVEL SECURITY;
      CREATE POLICY inbox_tenant_isolation ON sync.inbox
        USING (organization_id = rifad.current_organization_id())
        WITH CHECK (organization_id = rifad.current_organization_id());
      GRANT SELECT, INSERT ON sync.inbox TO ${RUNTIME_ROLE};
    `,
  },
]);

export class MigrationError extends Error {
  constructor(readonly code: 'MIGRATION_CHECKSUM_MISMATCH' | 'MIGRATION_UNKNOWN_APPLIED' | 'MIGRATION_INVALID', readonly migrationId: string) {
    super(`${code}: ${migrationId}`);
    this.name = 'MigrationError';
  }
}

export function checksum(migration: Migration): string {
  return createHash('sha256').update(migration.id + '\n' + migration.owner + '\n' + migration.sql).digest('hex');
}

/**
 * Applies pending migrations in order, in one transaction under an advisory lock, as the owner role.
 * Re-running is a no-op; an edited or removed deployed migration fails instead of drifting.
 */
export async function migrate<DB>(db: Kysely<DB>, migrations: readonly Migration[] = MIGRATIONS): Promise<string[]> {
  const ids = migrations.map(migration => migration.id);
  for (const [index, migration] of migrations.entries()) {
    if (!/^\d{4}_[a-z0-9_]+$/.test(migration.id) || !migration.owner || ids.indexOf(migration.id) !== index || (index > 0 && migration.id <= (ids[index - 1] ?? ''))) {
      throw new MigrationError('MIGRATION_INVALID', migration.id);
    }
  }
  return db.transaction().execute(async trx => {
    await sql`select pg_advisory_xact_lock(hashtext('rifad.migrations'))`.execute(trx);
    await sql`CREATE SCHEMA IF NOT EXISTS rifad_meta`.execute(trx);
    await sql`REVOKE ALL ON SCHEMA rifad_meta FROM PUBLIC`.execute(trx);
    await sql`CREATE TABLE IF NOT EXISTS rifad_meta.schema_migrations (
      id text PRIMARY KEY, owner text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`.execute(trx);
    const applied = new Map((await sql<{ id: string; checksum: string }>`select id, checksum from rifad_meta.schema_migrations`.execute(trx)).rows.map(row => [row.id, row.checksum]));
    for (const id of applied.keys()) if (!ids.includes(id)) throw new MigrationError('MIGRATION_UNKNOWN_APPLIED', id);
    const newlyApplied: string[] = [];
    for (const migration of migrations) {
      const known = applied.get(migration.id);
      if (known !== undefined) {
        if (known !== checksum(migration)) throw new MigrationError('MIGRATION_CHECKSUM_MISMATCH', migration.id);
        continue;
      }
      await sql.raw(migration.sql).execute(trx);
      await sql`insert into rifad_meta.schema_migrations (id, owner, checksum) values (${migration.id}, ${migration.owner}, ${checksum(migration)})`.execute(trx);
      newlyApplied.push(migration.id);
    }
    return newlyApplied;
  });
}
