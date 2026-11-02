import { sql, type Kysely, type Transaction } from 'kysely';

/** Tenant scope for one transaction, or explicit platform scope (no tenant rows visible under RLS). */
export type TransactionScope = { readonly organizationId: string } | 'platform';

export class TenantContextError extends Error {
  constructor() {
    super('Invalid tenant context');
    this.name = 'TenantContextError';
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Unit of work (M0-018): one database transaction. The tenant context is set transaction-locally
 * (`set_config(..., true)`), so it is cleared at commit/rollback and cannot leak to the next
 * pooled request (§14.1). Any thrown error rolls back every write in the transaction.
 */
export async function withTransaction<DB, T>(db: Kysely<DB>, scope: TransactionScope, work: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  if (scope !== 'platform' && !uuid.test(scope.organizationId)) throw new TenantContextError();
  return db.transaction().execute(async trx => {
    if (scope !== 'platform') await sql`select set_config('rifad.organization_id', ${scope.organizationId}, true)`.execute(trx);
    return work(trx);
  });
}
