import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { checkDatabase, createDatabase } from '@rifad/database';
import { configureHttpPlatform, registerReadiness } from '@rifad/http-platform';
import { createLogger } from '@rifad/logging';
import { ConfigError, loadConfig } from '@rifad/runtime-config';

@Controller()
class LivenessController {
  @Get('health/live')
  live() {
    return { status: 'alive', runtime: 'api', capability: 'batch-1-liveness-only' };
  }
}

@Module({ controllers: [LivenessController] })
class ApiRoot {}

const logger = createLogger({ runtime: 'api' });

async function bootstrap(): Promise<void> {
  const config = loadConfig('api', process.env);
  // Framework logging stays disabled; the structured logger writes redacted JSON lines instead.
  const app = await NestFactory.create<NestFastifyApplication>(ApiRoot, new FastifyAdapter({ logger: false }), { logger: false });
  configureHttpPlatform(app, logger);
  // The pool connects lazily: an unreachable database affects readiness, never liveness or startup.
  const database = config.databaseUrl === undefined ? undefined : createDatabase(config.databaseUrl, { applicationName: 'rifad-api' });
  registerReadiness(app, { database: async () => database ? checkDatabase(database.db) : 'not_configured' });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    await database?.close();
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
    await database?.close();
    throw new Error('LISTEN_FAILED');
  }
  logger.info('runtime.started', { environment: config.environment, host: config.host, port: config.port, database: database ? 'configured' : 'not_configured' });
}

void bootstrap().catch(error => {
  const code = error instanceof ConfigError ? 'INVALID_CONFIG' : 'STARTUP_FAILED';
  logger.error('runtime.failed', { code });
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
