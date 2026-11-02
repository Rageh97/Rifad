import { randomUUID } from 'node:crypto';
import { sql, type QueryExecutorProvider } from 'kysely';
import type { AuditEntry, AuditSink, AuditSinkFactory } from '@rifad/audit-contract';
import { RUNTIME_ROLE, type Migration } from '@rifad/database';
import { currentContext } from '@rifad/request-context';

export const AUDIT_MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    id: '0011_audit_trail',
    owner: 'audit',
    sql: `
      CREATE SCHEMA audit;
      REVOKE ALL ON SCHEMA audit FROM PUBLIC;
      GRANT USAGE ON SCHEMA audit TO ${RUNTIME_ROLE};
      CREATE TABLE audit.audit_event (
        organization_id uuid NOT NULL,
        audit_id uuid NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        actor_user_id uuid,
        action text NOT NULL CHECK (action ~ '^[a-z][a-z_]*\\.[a-z][a-z_]*$'),
        resource_type text NOT NULL CHECK (resource_type ~ '^[a-z][a-z_]{0,63}$'),
        resource_id text NOT NULL CHECK (length(resource_id) BETWEEN 1 AND 128),
        outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED', 'DENIED', 'FAILED')),
        request_id text,
        correlation_id text,
        details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(details) <= 4096),
        PRIMARY KEY (organization_id, audit_id)
      );
      CREATE INDEX audit_event_time ON audit.audit_event (organization_id, occurred_at);
      ALTER TABLE audit.audit_event ENABLE ROW LEVEL SECURITY;
      ALTER TABLE audit.audit_event FORCE ROW LEVEL SECURITY;
      CREATE POLICY audit_event_tenant ON audit.audit_event
        USING (organization_id = rifad.current_organization_id()) WITH CHECK (organization_id = rifad.current_organization_id());
      -- Append-only: no UPDATE or DELETE for the runtime role (immutable-ish trail, §25).
      GRANT SELECT, INSERT ON audit.audit_event TO ${RUNTIME_ROLE};
    `,
  },
]);

/**
 * Sink writing into the caller's transaction. Actor, request and correlation IDs come from the
 * request context (verified identity after the security pipeline; null for system actions).
 */
export function postgresAuditSink(trx: QueryExecutorProvider, organizationId: string): AuditSink {
  return Object.freeze({
    async record(entry: AuditEntry) {
      const context = currentContext();
      await sql`insert into audit.audit_event
        (organization_id, audit_id, actor_user_id, action, resource_type, resource_id, outcome, request_id, correlation_id, details)
        values (${organizationId}, ${randomUUID()}, ${context?.userId ?? null}, ${entry.action}, ${entry.resourceType}, ${entry.resourceId},
          ${entry.outcome}, ${context?.requestId ?? null}, ${context?.correlationId ?? null}, ${JSON.stringify(entry.details ?? {})}::jsonb)`.execute(trx);
    },
  });
}

export const postgresAuditSinkFactory: AuditSinkFactory = (executor, organizationId) => postgresAuditSink(executor as QueryExecutorProvider, organizationId);
