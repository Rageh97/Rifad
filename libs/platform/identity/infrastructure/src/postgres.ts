import { sql, type Kysely } from 'kysely';
import { RUNTIME_ROLE, type Migration } from '@rifad/database';
import type { UserDirectory } from '@rifad/identity-contract';

/**
 * Identity-owned migrations. External identities are platform-level (a person can belong to several
 * organizations, §14), so this table has no tenant column and no tenant RLS; the runtime role may
 * only read it. Provisioning writes it through the owner path (admin bootstrap, M0-039).
 */
export const IDENTITY_MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    id: '0008_identity_external_identity',
    owner: 'identity',
    sql: `
      CREATE SCHEMA identity;
      REVOKE ALL ON SCHEMA identity FROM PUBLIC;
      GRANT USAGE ON SCHEMA identity TO ${RUNTIME_ROLE};
      CREATE TABLE identity.external_identity (
        issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 500),
        subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
        user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (issuer, subject)
      );
      CREATE INDEX external_identity_user ON identity.external_identity (user_id);
      GRANT SELECT ON identity.external_identity TO ${RUNTIME_ROLE};
    `,
  },
]);

/**
 * Owner-path provisioning of an external identity (admin bootstrap, M0-039). The runtime role cannot
 * call this: it has only SELECT on the table. Fails with IDENTITY_ALREADY_PROVISIONED on duplicates.
 */
export async function provisionExternalIdentity<DB>(db: Kysely<DB>, input: { issuer: string; subject: string; userId: string }): Promise<void> {
  const result = await sql`insert into identity.external_identity (issuer, subject, user_id) values (${input.issuer}, ${input.subject}, ${input.userId})
    on conflict do nothing`.execute(db);
  if (result.numAffectedRows !== 1n) throw Object.assign(new Error('IDENTITY_ALREADY_PROVISIONED'), { code: 'IDENTITY_ALREADY_PROVISIONED' });
}

export function postgresUserDirectory<DB>(db: Kysely<DB>): UserDirectory {
  return Object.freeze({
    async findUserId(issuer: string, subject: string) {
      const row = (await sql<{ user_id: string }>`select user_id from identity.external_identity where issuer = ${issuer} and subject = ${subject}`.execute(db)).rows[0];
      return row?.user_id;
    },
  });
}
