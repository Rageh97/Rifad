import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
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

async function bootstrap(): Promise<void> {
  const config = loadConfig('worker', process.env);
  // Framework logging is disabled until the scoped structured logging task exists.
  const app = await NestFactory.create<NestFastifyApplication>(WorkerRoot, new FastifyAdapter({ logger: false }), { logger: false });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
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
    throw new Error('LISTEN_FAILED');
  }
  process.stdout.write(JSON.stringify({ event: 'runtime.started', runtime: config.runtime, environment: config.environment, host: config.host, port: config.port }) + '\n');
}

void bootstrap().catch(error => {
  const code = error instanceof ConfigError ? 'INVALID_CONFIG' : 'STARTUP_FAILED';
  process.stderr.write(JSON.stringify({ event: 'runtime.failed', runtime: 'worker', code }) + '\n');
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
