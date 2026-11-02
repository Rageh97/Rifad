import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { OWNER_ROLE, RUNTIME_ROLE, provisionLocalDatabase } from '../index';

const run = promisify(execFile);

/** PostgreSQL 18.6 pinned by digest (E03, verified 2026-11-02). */
export const POSTGRES_IMAGE = 'postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';

export interface PostgresServer {
  readonly adminUrl: string;
  readonly ownerUrl: string;
  readonly appUrl: string;
  readonly port: number;
  stop(): Promise<void>;
}

const secret = () => randomBytes(18).toString('hex');

async function docker(args: string[], timeout = 120_000): Promise<string> {
  try {
    return (await run('docker', args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 })).stdout.trim();
  } catch (error) {
    const reason = (error as { code?: unknown }).code === 'ENOENT' ? 'DOCKER_CLI_MISSING' : 'DOCKER_COMMAND_FAILED';
    throw new Error(`${reason}: docker ${args[0]} (integration tests require a running Docker engine)`);
  }
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
    const mapping = await docker(['port', container, '5432/tcp']);
    const port = Number(/:(\d+)\s*$/m.exec(mapping.split('\n')[0] ?? '')?.[1]);
    if (!Number.isInteger(port)) throw new Error('DOCKER_PORT_UNAVAILABLE');
    const adminUrl = `postgres://postgres:${adminPassword}@127.0.0.1:${port}/postgres`;
    const deadline = Date.now() + 60_000;
    for (;;) {
      const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 2_000 });
      try { await client.connect(); await client.query('select 1'); await client.end(); break; }
      catch { await client.end().catch(() => undefined); if (Date.now() > deadline) throw new Error('POSTGRES_START_TIMEOUT'); }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const ownerPassword = secret();
    const appPassword = secret();
    await provisionLocalDatabase({ adminUrl, database: 'rifad', ownerPassword, appPassword });
    return Object.freeze({
      adminUrl: `postgres://postgres:${adminPassword}@127.0.0.1:${port}/rifad`,
      ownerUrl: `postgres://${OWNER_ROLE}:${ownerPassword}@127.0.0.1:${port}/rifad`,
      appUrl: `postgres://${RUNTIME_ROLE}:${appPassword}@127.0.0.1:${port}/rifad`,
      port, stop,
    });
  } catch (error) {
    await stop();
    throw error;
  }
}
