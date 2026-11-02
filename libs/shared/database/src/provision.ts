import { Client } from 'pg';
import { RUNTIME_ROLE } from './migrations';

export const OWNER_ROLE = 'rifad_owner';

export interface LocalProvisioning {
  /** Superuser URL of a disposable local/test server. */
  readonly adminUrl: string;
  readonly database: string;
  readonly ownerPassword: string;
  readonly appPassword: string;
}

const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Local/test provisioning only: separate owner/migration and runtime roles plus a database owned
 * by the owner role. Production roles are provisioned by infrastructure, never by this function.
 */
export async function provisionLocalDatabase(input: LocalProvisioning): Promise<void> {
  if (!loopback.has(new URL(input.adminUrl).hostname)) throw new Error('LOCAL_PROVISIONING_ONLY');
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(input.database)) throw new Error('INVALID_DATABASE_NAME');
  const admin = new Client({ connectionString: input.adminUrl });
  await admin.connect();
  try {
    const statement = async (template: string, value: string) => {
      const { rows } = await admin.query<{ statement: string }>(`select format(${template}, $1::text) as statement`, [value]);
      await admin.query(rows[0]?.statement ?? 'select 1');
    };
    await statement(`'CREATE ROLE ${OWNER_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L'`, input.ownerPassword);
    await statement(`'CREATE ROLE ${RUNTIME_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD %L'`, input.appPassword);
    await admin.query(`CREATE DATABASE ${input.database} OWNER ${OWNER_ROLE}`);
    await admin.query(`REVOKE ALL ON DATABASE ${input.database} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${input.database} TO ${RUNTIME_ROLE}`);
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
