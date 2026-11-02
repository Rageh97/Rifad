import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { checkDatabase, createDatabase } from '@rifad/database';
import { configureHttpPlatform, registerReadiness } from '@rifad/http-platform';
import { createLogger } from '@rifad/logging';
import { initTracing } from '@rifad/observability';
import { startRelay, type RelayHandle } from '@rifad/outbox-relay';
import { checkQueue, createEventQueue } from '@rifad/queue';
import { ConfigError, loadConfig } from '@rifad/runtime-config';

@Controller()
class LivenessController {
  @Get('health/live')
  live() {
    return { status: 'alive', runtime: 'worker', capability: 'batch-1-liveness-only' };
  }
}

@Module({ controllers: [LivenessController] })
class WorkerRoot {}

const logger = createLogger({ runtime: 'worker' });

async function bootstrap(): Promise<void> {
  const config = loadConfig('worker', process.env);
  // Before the HTTP app so every request span and log line carries trace context (M0-024).
  const tracing = initTracing({ runtime: 'worker', ...(config.otelExporterUrl ? { exporterUrl: config.otelExporterUrl } : {}) });
  // Framework logging stays disabled; the structured logger writes redacted JSON lines instead.
  const app = await NestFactory.create<NestFastifyApplication>(WorkerRoot, new FastifyAdapter({ logger: false }), { logger: false });
  configureHttpPlatform(app, logger);
  // Pools connect lazily: an unreachable database or queue affects readiness, never liveness or startup.
  const database = config.databaseUrl === undefined ? undefined : createDatabase(config.databaseUrl, { applicationName: 'rifad-worker' });
  const relayDatabase = config.relayDatabaseUrl === undefined ? undefined : createDatabase(config.relayDatabaseUrl, { applicationName: 'rifad-relay', maxConnections: 2 });
  const queueUrl = config.queueRedisUrl;
  const queue = queueUrl === undefined ? undefined : createEventQueue({ url: queueUrl });
  queue?.on('error', () => undefined);
  registerReadiness(app, {
    database: async () => database ? checkDatabase(database.db) : 'not_configured',
    queue: async () => queueUrl ? checkQueue({ url: queueUrl }) : 'not_configured',
  });
  let relay: RelayHandle | undefined;
  let stopping = false;
  const closeResources = async () => {
    await relay?.stop();
    // Closing a queue whose Redis is down can wait indefinitely; shutdown must stay bounded.
    await Promise.race([queue?.close().catch(() => undefined), new Promise(done => setTimeout(done, 5_000).unref())]);
    await relayDatabase?.close();
    await database?.close();
  };
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    await closeResources();
    await tracing.shutdown();
    process.exitCode = 0;
  };
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
  // IPC is available only when launched by a parent process (portable smoke tests).
  process.on('message', message => {
    if (message === 'shutdown') void stop().finally(() => { if (process.connected) process.disconnect(); });
  });
  try {
    await app.listen(config.port, config.host);
  } catch {
    await app.close();
    await closeResources();
    await tracing.shutdown();
    throw new Error('LISTEN_FAILED');
  }
  if (relayDatabase && queue) {
    relay = startRelay(relayDatabase.db, queue, {
      onResult: result => logger.info('outbox.relay.pass', { ...result }),
      onError: error => logger.warn('outbox.relay.failed', { error }),
    });
  }
  logger.info('runtime.started', {
    environment: config.environment, host: config.host, port: config.port,
    database: database ? 'configured' : 'not_configured', relay: relay ? 'running' : 'not_configured',
  });
}

void bootstrap().catch(error => {
  const code = error instanceof ConfigError ? 'INVALID_CONFIG' : 'STARTUP_FAILED';
  logger.error('runtime.failed', { code });
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
