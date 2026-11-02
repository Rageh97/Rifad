import { sql, type Kysely, type QueryExecutorProvider } from 'kysely';
import type { AuditSink, AuditSinkFactory } from '@rifad/audit-contract';
import { RUNTIME_ROLE, withTransaction, type Migration } from '@rifad/database';
import type { EntitlementRepository, EntitlementsUnitOfWork } from '@rifad/entitlements-application';
import type { EntitlementQuery, Feature } from '@rifad/entitlements-contract';
import { isEnabled, type OrganizationEntitlement } from '@rifad/entitlements-domain';

export const ENTITLEMENTS_MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    id: '0010_entitlements_core',
    owner: 'entitlements',
    sql: `
      CREATE SCHEMA entitlements;
      REVOKE ALL ON SCHEMA entitlements FROM PUBLIC;
      GRANT USAGE ON SCHEMA entitlements TO ${RUNTIME_ROLE};
      CREATE TABLE entitlements.organization_feature (
        organization_id uuid NOT NULL,
        feature text NOT NULL CHECK (feature ~ '^[a-z]+\\.[a-z_]+$'),
        enabled boolean NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (organization_id, feature)
      );
      ALTER TABLE entitlements.organization_feature ENABLE ROW LEVEL SECURITY;
      ALTER TABLE entitlements.organization_feature FORCE ROW LEVEL SECURITY;
      CREATE POLICY organization_feature_tenant ON entitlements.organization_feature
        USING (organization_id = rifad.current_organization_id()) WITH CHECK (organization_id = rifad.current_organization_id());
      GRANT SELECT, INSERT ON entitlements.organization_feature TO ${RUNTIME_ROLE};
      GRANT UPDATE (enabled, updated_at) ON entitlements.organization_feature TO ${RUNTIME_ROLE};
    `,
  },
]);

function repository(trx: QueryExecutorProvider, organizationId: string, audit?: AuditSink): EntitlementRepository {
  return Object.freeze({
    async get(feature: Feature) {
      const row = (await sql<{ enabled: boolean }>`select enabled from entitlements.organization_feature
        where organization_id = ${organizationId} and feature = ${feature}`.execute(trx)).rows[0];
      return row && Object.freeze({ organizationId, feature, enabled: row.enabled });
    },
    async upsert(e: OrganizationEntitlement) {
      await sql`insert into entitlements.organization_feature (organization_id, feature, enabled) values (${e.organizationId}, ${e.feature}, ${e.enabled})
        on conflict (organization_id, feature) do update set enabled = excluded.enabled, updated_at = now()`.execute(trx);
      await audit?.record({ action: 'entitlements.feature_set', resourceType: 'feature', resourceId: e.feature, outcome: 'SUCCEEDED', details: { enabled: e.enabled } });
    },
  });
}

/** `audit` records every entitlement change in the same transaction (M0-017). */
export function postgresEntitlementsUnitOfWork<DB>(db: Kysely<DB>, audit?: AuditSinkFactory): EntitlementsUnitOfWork {
  return Object.freeze({
    run: <T>(organizationId: string, work: (repo: EntitlementRepository) => Promise<T>) =>
      withTransaction(db, { organizationId }, trx => work(repository(trx, organizationId, audit?.(trx, organizationId)))),
  });
}

export function postgresEntitlementQuery<DB>(db: Kysely<DB>): EntitlementQuery {
  return Object.freeze({
    isEnabled: (organizationId: string, feature: Feature) =>
      withTransaction(db, { organizationId }, async trx => isEnabled(feature, await repository(trx, organizationId).get(feature))),
  });
}
