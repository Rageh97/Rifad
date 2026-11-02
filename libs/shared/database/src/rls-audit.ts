import { sql, type Kysely } from 'kysely';
import { RUNTIME_ROLE } from './migrations';

export interface RlsViolation {
  readonly table: string;
  readonly problem: 'RLS_DISABLED' | 'RLS_NOT_FORCED' | 'NO_POLICY' | 'RUNTIME_ROLE_OWNS_TABLE';
}

/**
 * Tables with an organization_id column are tenant-owned and must enable and force RLS with at
 * least one policy (ADR-043). Documented exceptions would be listed here; there are none.
 */
const exceptions: ReadonlySet<string> = new Set();

/** Catalog audit used by integration tests now and by the M0-046 verification gate later. */
export async function auditTenantTables<DB>(db: Kysely<DB>): Promise<RlsViolation[]> {
  const rows = (await sql<{ table: string; enabled: boolean; forced: boolean; policies: number; owner: string }>`
    select n.nspname || '.' || c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
           (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies, pg_get_userbyid(c.relowner) as owner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped)
    order by 1`.execute(db)).rows;
  const violations: RlsViolation[] = [];
  for (const row of rows) {
    if (exceptions.has(row.table)) continue;
    if (!row.enabled) violations.push({ table: row.table, problem: 'RLS_DISABLED' });
    if (!row.forced) violations.push({ table: row.table, problem: 'RLS_NOT_FORCED' });
    if (row.policies < 1) violations.push({ table: row.table, problem: 'NO_POLICY' });
    if (row.owner === RUNTIME_ROLE) violations.push({ table: row.table, problem: 'RUNTIME_ROLE_OWNS_TABLE' });
  }
  return violations;
}

/** The runtime role must not be a superuser, bypass RLS, create roles/databases, or own any relation. */
export async function auditRuntimeRole<DB>(db: Kysely<DB>, role = RUNTIME_ROLE): Promise<string[]> {
  const found = (await sql<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean; owned: number }>`
    select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
           (select count(*)::int from pg_class c where c.relowner = r.oid) as owned
    from pg_roles r where rolname = ${role}`.execute(db)).rows[0];
  if (!found) return ['ROLE_MISSING'];
  return [
    ...(found.rolsuper ? ['SUPERUSER'] : []), ...(found.rolbypassrls ? ['BYPASSRLS'] : []),
    ...(found.rolcreaterole ? ['CREATEROLE'] : []), ...(found.rolcreatedb ? ['CREATEDB'] : []),
    ...(found.owned > 0 ? ['OWNS_RELATIONS'] : []),
  ];
}
