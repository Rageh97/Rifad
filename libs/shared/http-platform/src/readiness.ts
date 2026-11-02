import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export type DependencyState = 'ready' | 'unavailable' | 'not_configured' | 'misconfigured';
export type ReadinessChecks = Readonly<Record<string, () => Promise<DependencyState>>>;

/**
 * `GET /health/ready` (M0-035): traffic-ready only when every critical dependency is ready;
 * otherwise 503 with per-dependency state and no connection details. Liveness stays independent.
 */
export function registerReadiness(app: NestFastifyApplication, checks: ReadinessChecks): void {
  if (!Object.keys(checks).length) throw new TypeError('Readiness needs at least one critical dependency');
  app.getHttpAdapter().getInstance().get('/health/ready', async (_request, reply) => {
    const entries = await Promise.all(Object.entries(checks).map(async ([name, check]) => [name, await check().catch((): DependencyState => 'unavailable')] as const));
    const ready = entries.every(([, state]) => state === 'ready');
    return reply.status(ready ? 200 : 503).header('cache-control', 'no-store').send({ status: ready ? 'ready' : 'not_ready', checks: Object.fromEntries(entries) });
  });
}
