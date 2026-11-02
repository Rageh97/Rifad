import { Client } from 'pg';
import { docker, mappedPort, secret, waitFor } from './docker';
import { ROLES, provisionLocalDatabase } from './provision';

/** PostgreSQL 18.6 pinned by digest (E03, verified 2026-11-02). */
export const POSTGRES_IMAGE = 'postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';

export interface PostgresServer {
  readonly adminUrl: string;
  readonly ownerUrl: string;
  readonly appUrl: string;
  readonly relayUrl: string;
  readonly port: number;
  stop(): Promise<void>;
}

/**
 * Disposable server on an ephemeral loopback port with tmpfs storage and synthetic credentials.
 * Fails the suite (never skips) when Docker is unavailable.
 */
export async function startPostgres(): Promise<PostgresServer> {
  const adminPassword = secret();
  const container = await docker(['run', '-d', '--rm', '--label', 'rifad.test=integration', '-e', `POSTGRES_PASSWORD=${adminPassword}`,
    '--tmpfs', '/var/lib/postgresql:rw', '-p', '127.0.0.1::5432', POSTGRES_IMAGE], 300_000);
  const stop = async () => { await docker(['rm', '-f', container]).catch(() => undefined); };
  try {
    const port = await mappedPort(container, '5432/tcp');
    const adminUrl = `postgres://postgres:${adminPassword}@127.0.0.1:${port}/postgres`;
    await waitFor(async () => {
      const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 2_000 });
      try { await client.connect(); await client.query('select 1'); } finally { await client.end().catch(() => undefined); }
    }, 60_000, 'POSTGRES_START_TIMEOUT');
    const passwords = { owner: secret(), app: secret(), relay: secret() };
    await provisionLocalDatabase({ adminUrl, database: 'rifad', passwords });
    const url = (role: string, password: string) => `postgres://${role}:${password}@127.0.0.1:${port}/rifad`;
    return Object.freeze({
      adminUrl: url('postgres', adminPassword), ownerUrl: url(ROLES.owner, passwords.owner),
      appUrl: url(ROLES.app, passwords.app), relayUrl: url(ROLES.relay, passwords.relay), port, stop,
    });
  } catch (error) {
    await stop();
    throw error;
  }
}
