import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

/** Queue carrying Cloud-plane events published from the Postgres outbox (never Edge events, ADR-041). */
export const CLOUD_EVENTS_QUEUE = 'rifad-cloud-events';

/**
 * Queue Redis is dedicated and separate from any cache (§21): it must use `noeviction` so jobs are
 * never silently dropped under memory pressure, with persistence enabled by the operator.
 */
export const REQUIRED_EVICTION_POLICY = 'noeviction';

export interface QueueConnection {
  readonly url: string;
}

/**
 * Bounded, fail-fast BullMQ connection options; the queue is never the source of truth. Reconnects
 * keep retrying every 0.2–2 s (BullMQ's default backs off to 20 s), so publishing resumes promptly
 * after a Redis restart while pending events wait safely in the Postgres outbox.
 */
export function connectionOptions(connection: QueueConnection) {
  return {
    url: connection.url, maxRetriesPerRequest: null, enableOfflineQueue: false, connectTimeout: 5_000, lazyConnect: true,
    retryStrategy: (times: number) => Math.min(times * 200, 2_000),
  };
}

export function createEventQueue(connection: QueueConnection): Queue {
  return new Queue(CLOUD_EVENTS_QUEUE, {
    connection: connectionOptions(connection),
    // Completed jobs are kept for a dedupe window so a relay retry with the same jobId is a no-op.
    defaultJobOptions: { removeOnComplete: { age: 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 }, attempts: 5, backoff: { type: 'exponential', delay: 1_000 } },
  });
}

/**
 * Readiness of the queue Redis: reachable and configured with `noeviction`. Never throws and never
 * reports connection details. Managed services that hide CONFIG must be verified operationally.
 */
export async function checkQueue(connection: QueueConnection, timeoutMs = 2_000): Promise<'ready' | 'unavailable' | 'misconfigured'> {
  const client = new Redis(connection.url, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false, connectTimeout: timeoutMs, retryStrategy: () => null });
  client.on('error', () => undefined);
  let timer: NodeJS.Timeout | undefined;
  try {
    const probe = (async () => {
      await client.connect();
      const reply = await client.config('GET', 'maxmemory-policy') as unknown;
      const policy = Array.isArray(reply) ? reply[1] : undefined;
      return policy === REQUIRED_EVICTION_POLICY ? 'ready' as const : 'misconfigured' as const;
    })();
    // A probe that settles after the deadline must not become an unhandled rejection.
    probe.catch(() => undefined);
    const deadline = new Promise<'unavailable'>(resolve => { timer = setTimeout(() => resolve('unavailable'), timeoutMs); });
    return await Promise.race([probe, deadline]);
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
    client.disconnect();
  }
}
