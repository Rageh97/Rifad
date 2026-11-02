import { Client } from 'pg';

/** Role names fixed by the database migrations (@rifad/database); audits fail if they drift. */
export const ROLES = Object.freeze({ owner: 'rifad_owner', app: 'rifad_app', relay: 'rifad_relay' });

export interface LocalProvisioning {
  /** Superuser URL of a disposable local/test server. */
  readonly adminUrl: string;
  readonly database: string;
  readonly passwords: { readonly owner: string; readonly app: string; readonly relay: string };
}

const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Local/test provisioning only: an owner/migration role, the runtime role, the scoped relay role and
 * a database owned by the owner. Production roles are provisioned by infrastructure, never here.
 */
export async function provisionLocalDatabase(input: LocalProvisioning): Promise<void> {
  if (!loopback.has(new URL(input.adminUrl).hostname)) throw new Error('LOCAL_PROVISIONING_ONLY');
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(input.database)) throw new Error('INVALID_DATABASE_NAME');
  const admin = new Client({ connectionString: input.adminUrl });
  await admin.connect();
  try {
    const createRole = async (role: string, attributes: string, password: string) => {
      const { rows } = await admin.query<{ statement: string }>(`select format('CREATE ROLE %I LOGIN ${attributes} PASSWORD %L', $1::text, $2::text) as statement`, [role, password]);
      await admin.query(rows[0]?.statement ?? 'select 1');
    };
    await createRole(ROLES.owner, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', input.passwords.owner);
    await createRole(ROLES.app, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT', input.passwords.app);
    await createRole(ROLES.relay, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT', input.passwords.relay);
    await admin.query(`CREATE DATABASE ${input.database} OWNER ${ROLES.owner}`);
    await admin.query(`REVOKE ALL ON DATABASE ${input.database} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${input.database} TO ${ROLES.app}, ${ROLES.relay}`);
  } finally {
    await admin.end();
  }
  const target = new URL(input.adminUrl);
  target.pathname = '/' + input.database;
  const database = new Client({ connectionString: target.toString() });
  await database.connect();
  try {
    await database.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  } finally {
    await database.end();
  }
}
