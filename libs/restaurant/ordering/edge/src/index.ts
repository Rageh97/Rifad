import { randomUUID } from 'node:crypto';
import { DomainError, type DomainEvent } from '@rifad/kernel';
import { EdgeScopeError, appendLocalEvent, type EdgeMigration, type EdgeStore } from '@rifad/edge-store';
import type { CheckEventSink, CheckRepository, OrderingUnitOfWork } from '@rifad/ordering-application';
import type { Check } from '@rifad/ordering-domain';
import { currentCorrelationId } from '@rifad/request-context';

/**
 * Ordering-owned Edge migrations (ADR-037: branch checks live in Edge SQLite). Pass them to
 * `openEdgeStore({ migrations })`. The aggregate is stored as a versioned document; rounds and
 * voided lines stay inside it as history.
 */
export const ORDERING_EDGE_MIGRATIONS: readonly EdgeMigration[] = Object.freeze([
  {
    id: '0101_ordering_check',
    sql: `
      CREATE TABLE ordering_check (
        check_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSING', 'CLOSED', 'CANCELLED')),
        version INTEGER NOT NULL CHECK (version > 0),
        document TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX ordering_check_open ON ordering_check (status) WHERE status IN ('OPEN', 'CLOSING');
    `,
  },
]);

function repository(store: EdgeStore): CheckRepository {
  const inScope = (check: Check) => {
    if (check.organizationId !== store.identity.organizationId || check.branchId !== store.identity.branchId) throw new EdgeScopeError();
  };
  return Object.freeze({
    get(checkId: string) {
      const row = store.db.prepare('select document from ordering_check where check_id = ? and organization_id = ? and branch_id = ?')
        .get(checkId, store.identity.organizationId, store.identity.branchId) as { document: string } | undefined;
      return row ? (JSON.parse(row.document) as Check) : undefined;
    },
    insert(check: Check) {
      inScope(check);
      store.db.prepare('insert into ordering_check (check_id, organization_id, branch_id, status, version, document, updated_at) values (?, ?, ?, ?, ?, ?, ?)')
        .run(check.checkId, check.organizationId, check.branchId, check.status, check.version, JSON.stringify(check), new Date().toISOString());
    },
    update(check: Check, expectedVersion: number) {
      inScope(check);
      const result = store.db.prepare('update ordering_check set status = ?, version = ?, document = ?, updated_at = ? where check_id = ? and version = ?')
        .run(check.status, check.version, JSON.stringify(check), new Date().toISOString(), check.checkId, expectedVersion);
      if (result.changes !== 1) throw new DomainError('CONCURRENT_MODIFICATION', 'The check was changed by another request.', 'conflict');
    },
  });
}

/** Maps domain events to durable EDGE-plane envelopes, ordered per check (ADR-033/041). */
function eventSink(store: EdgeStore): CheckEventSink {
  return Object.freeze({
    append(check: Check, events: readonly DomainEvent[]) {
      for (const event of events) {
        appendLocalEvent(store, {
          eventId: randomUUID(), eventType: event.eventType, eventVersion: event.eventVersion, plane: 'EDGE', ordering: 'PER_AGGREGATE',
          organizationId: check.organizationId, branchId: check.branchId, aggregateType: 'check', aggregateId: check.checkId,
          aggregateVersion: event.aggregateVersion, occurredAt: event.occurredAt, correlationId: currentCorrelationId(), causationId: null,
          idempotencyKey: `${event.eventType}:${check.checkId}:${event.aggregateVersion}`, payload: event.payload,
        });
      }
    },
  });
}

/** One immediate SQLite transaction per command: check state and local outbox commit together (M0-031). */
export function edgeOrderingUnitOfWork(store: EdgeStore): OrderingUnitOfWork {
  const checks = repository(store);
  const events = eventSink(store);
  return Object.freeze({
    run: <T>(work: (checks: CheckRepository, events: CheckEventSink) => T): T => store.db.transaction(() => work(checks, events)).immediate(),
  });
}
