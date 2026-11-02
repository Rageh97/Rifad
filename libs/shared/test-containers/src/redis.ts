import { createConnection, createServer } from 'node:net';
import { docker, secret, waitFor } from './docker';

/** Redis 8.10.3 pinned by digest (E03, verified 2026-11-02). */
export const REDIS_IMAGE = 'redis:8-alpine@sha256:21090af93f8324db2f0f0f4f38a7c60369d47d917e000c3423d89d2ae2883537';

export interface RedisServer {
  readonly url: string;
  readonly port: number;
  /** Stops the same container (connections refused); append-only data is kept. */
  down(): Promise<void>;
  /** Starts it again on the same port and waits until it answers. */
  up(): Promise<void>;
  stop(): Promise<void>;
}

/** Answers once Redis accepts an authenticated PING, using a raw RESP exchange (no client library). */
function ping(port: number, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => socket.write(`AUTH ${password}\r\nPING\r\n`));
    let data = '';
    socket.setTimeout(2_000, () => { socket.destroy(); reject(new Error('timeout')); });
    socket.on('data', chunk => { data += chunk; if (data.includes('+PONG')) { socket.end(); resolve(); } else if (data.includes('-')) { socket.destroy(); reject(new Error('not ready')); } });
    socket.on('error', reject);
  });
}

/**
 * Queue Redis as production expects it: dedicated, `noeviction`, append-only persistence, password.
 * `misconfigured: true` starts it with an evicting policy to prove readiness rejects that.
 */
export async function startRedis(options: { misconfigured?: boolean } = {}): Promise<RedisServer> {
  const password = secret();
  const policy = options.misconfigured ? 'allkeys-lru' : 'noeviction';
  // A fixed host port keeps the same URL across restarts, so clients can reconnect.
  const port = await new Promise<number>((resolve, reject) => { const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => { const value = (probe.address() as { port: number }).port; probe.close(() => resolve(value)); }); });
  const container = await docker(['run', '-d', '--label', 'rifad.test=integration', '-p', `127.0.0.1:${port}:6379`, REDIS_IMAGE,
    'redis-server', '--requirepass', password, '--maxmemory-policy', policy, '--appendonly', 'yes', '--appendfsync', 'always', '--save', ''], 300_000);
  const stop = async () => { await docker(['rm', '-f', container]).catch(() => undefined); };
  try {
    await waitFor(() => ping(port, password), 30_000, 'REDIS_START_TIMEOUT');
    const server = {
      url: `redis://:${password}@127.0.0.1:${port}`,
      port,
      async down() { await docker(['stop', '-t', '5', container]); },
      async up() {
        await docker(['start', container]);
        await waitFor(() => ping(port, password), 30_000, 'REDIS_START_TIMEOUT');
      },
      stop,
    };
    return server;
  } catch (error) {
    await stop();
    throw error;
  }
}
