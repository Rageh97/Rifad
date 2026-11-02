import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { BadRequestException, Body, Controller, Get, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InjectOptions } from 'fastify';
import { DomainError } from '@rifad/kernel';
import { createLogger } from '@rifad/logging';
import { requireContext } from '@rifad/request-context';
import { configureHttpPlatform, registerReadiness, toApiError, type DependencyState } from './index';

const canary = ['synthetic', 'secret', 'canary'].join('-');

@Controller()
class ProbeController {
  @Get('domain') domain() { throw new DomainError('CHECK_ALREADY_CLOSED', 'Check is closed.', 'conflict'); }
  @Get('crash') crash() { throw new Error(`SELECT * FROM secret_table WHERE token='${canary}'`); }
  @Get('http') http() { throw new BadRequestException(`internal detail ${canary}`); }
  @Get('context') async context() { await delay(5); return { correlationId: requireContext().correlationId, requestId: requireContext().requestId }; }
  @Post('echo') async echo(@Body() body: unknown) { await delay(1); return { correlationId: requireContext().correlationId, body }; }
}

@Module({ controllers: [ProbeController] })
class ProbeRoot {}

let app: NestFastifyApplication;
const inject = (options: InjectOptions) => app.getHttpAdapter().getInstance().inject(options);
const logs: Record<string, unknown>[] = [];
const logger = createLogger({ runtime: 'test', sink: (_level, line) => logs.push(JSON.parse(line)) });

before(async () => {
  app = await NestFactory.create<NestFastifyApplication>(ProbeRoot, new FastifyAdapter({ logger: false }), { logger: false });
  configureHttpPlatform(app, logger);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
after(async () => { await app.close(); });

function assertErrorBody(response: { statusCode: number; headers: Record<string, unknown>; body: string }, status: number, code: string) {
  assert.equal(response.statusCode, status);
  const body = JSON.parse(response.body);
  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message', 'requestId']);
  assert.equal(body.error.code, code);
  assert.equal(body.error.requestId, response.headers['x-request-id']);
  assert.ok(!response.body.includes(canary) && !response.body.includes(' at ') && !/select|secret_table/i.test(response.body));
  return body.error;
}

test('domain errors keep their stable code and map category to status', async () => {
  const error = assertErrorBody(await inject({ method: 'GET', url: '/domain' }), 409, 'CHECK_ALREADY_CLOSED');
  assert.equal(error.message, 'Check is closed.');
});

test('unknown failures never leak stack, SQL or values', async () => {
  const error = assertErrorBody(await inject({ method: 'GET', url: '/crash' }), 500, 'INTERNAL_ERROR');
  assert.equal(error.message, 'Internal error.');
});

test('transport errors use fixed messages instead of exception text', async () => {
  assert.equal(assertErrorBody(await inject({ method: 'GET', url: '/http' }), 400, 'BAD_REQUEST').message, 'Request is invalid.');
  assertErrorBody(await inject({ method: 'GET', url: '/api/v1/checks' }), 404, 'NOT_FOUND');
  assertErrorBody(await inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/json' }, payload: '{"broken":' + canary }), 400, 'BAD_REQUEST');
  assertErrorBody(await inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'text/x-unknown' }, payload: canary }), 415, 'UNSUPPORTED_MEDIA_TYPE');
});

test('request context reaches async handlers, including after body parsing', async () => {
  const response = await inject({ method: 'GET', url: '/context', headers: { 'x-correlation-id': 'pos-7:42' } });
  const body = JSON.parse(response.body);
  assert.equal(body.correlationId, 'pos-7:42');
  assert.equal(response.headers['x-correlation-id'], 'pos-7:42');
  assert.equal(body.requestId, response.headers['x-request-id']);
  const posted = await inject({ method: 'POST', url: '/echo', headers: { 'x-correlation-id': 'post-1' }, payload: { round: 2 } });
  assert.deepEqual(JSON.parse(posted.body), { correlationId: 'post-1', body: { round: 2 } });
});

test('concurrent requests keep isolated contexts; malformed correlation IDs are replaced', async () => {
  const ids = Array.from({ length: 20 }, (_, index) => 'c-' + index);
  const responses = await Promise.all(ids.map(id => inject({ method: 'GET', url: '/context', headers: { 'x-correlation-id': id } })));
  assert.deepEqual(responses.map(response => JSON.parse(response.body).correlationId), ids);
  const replaced = await inject({ method: 'GET', url: '/context', headers: { 'x-correlation-id': '<' + canary + '>' } });
  const body = JSON.parse(replaced.body);
  assert.equal(body.correlationId, body.requestId);
  assert.ok(!replaced.body.includes(canary));
});

test('error mapping is total for unusual thrown values', () => {
  for (const value of [undefined, null, 'string', 42, { statusCode: 'x' }, { statusCode: 502 }, Object.create(null)]) {
    assert.deepEqual(toApiError(value, 'r').body.error.code, 'INTERNAL_ERROR');
  }
  assert.equal(toApiError({ statusCode: 413 }, 'r').body.error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(toApiError({ statusCode: 418 }, 'r').body.error.code, 'REQUEST_REJECTED');
  assert.equal(toApiError({ statusCode: 503 }, 'r').status, 503);
  assert.equal(toApiError(new DomainError('BAD_INPUT', 'Bad input.', 'validation'), 'r').status, 400);
});

test('each request logs one redacted completion line correlated with the response', async () => {
  logs.length = 0;
  const response = await inject({ method: 'GET', url: '/crash?token=' + canary, headers: { 'x-correlation-id': 'trace-9' } });
  const lines = logs.filter(entry => entry['event'] === 'http.request.completed');
  assert.equal(lines.length, 1);
  assert.deepEqual({ ...lines[0], time: undefined, durationMs: undefined }, {
    method: 'GET', path: '/crash', statusCode: 500, durationMs: undefined, time: undefined, level: 'info', runtime: 'test', event: 'http.request.completed',
    requestId: response.headers['x-request-id'], correlationId: 'trace-9',
  });
  assert.equal(typeof lines[0]?.['durationMs'], 'number');
  assert.ok(!JSON.stringify(logs).includes(canary));
});

test('readiness is 200 only when every dependency is ready and never leaks details', async () => {
  const states: Record<string, DependencyState> = { database: 'ready', queue: 'ready' };
  const probe = await NestFactory.create<NestFastifyApplication>(ProbeRoot, new FastifyAdapter({ logger: false }), { logger: false });
  configureHttpPlatform(probe, logger);
  registerReadiness(probe, {
    database: async () => states['database'] ?? 'unavailable',
    queue: async () => { if (states['queue'] === 'unavailable') throw new Error(canary); return states['queue'] ?? 'unavailable'; },
  });
  await probe.init();
  const fastify = probe.getHttpAdapter().getInstance();
  try {
    const ready = await fastify.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(JSON.parse(ready.body), { status: 'ready', checks: { database: 'ready', queue: 'ready' } });
    states['database'] = 'not_configured';
    states['queue'] = 'unavailable';
    const notReady = await fastify.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(notReady.statusCode, 503);
    assert.deepEqual(JSON.parse(notReady.body), { status: 'not_ready', checks: { database: 'not_configured', queue: 'unavailable' } });
    assert.ok(!notReady.body.includes(canary));
  } finally { await probe.close(); }
  assert.throws(() => registerReadiness(app, {}), TypeError);
});
