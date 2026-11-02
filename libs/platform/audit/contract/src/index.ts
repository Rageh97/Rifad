/**
 * Public contract of the Audit context (M0-017, §15): an append-only business/security trail,
 * separate from logs and the outbox (§25 Audit). Contexts record through an `AuditSink` bound to their
 * own transaction, so an audited change and its audit record commit or roll back together.
 */

export type AuditOutcome = 'SUCCEEDED' | 'DENIED' | 'FAILED';

export interface AuditEntry {
  /** `<context>.<action>`, e.g. `authorization.role_assigned`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly outcome: AuditOutcome;
  /** Small, non-sensitive facts (IDs, old/new status). Never secrets, payloads or personal data. */
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AuditSink {
  record(entry: AuditEntry): Promise<void>;
}

/**
 * Creates a sink inside a caller's transaction. `executor` is the adapter's own transaction handle;
 * the contract stays free of database types.
 */
export type AuditSinkFactory = (executor: unknown, organizationId: string) => AuditSink;
