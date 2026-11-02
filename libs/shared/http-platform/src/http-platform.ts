import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from '@rifad/logging';
import { CORRELATION_HEADER, REQUEST_ID_HEADER, contextFromHeaders, currentContext, runWithContext, type RequestContext } from '@rifad/request-context';
import { toApiError } from './api-error';

const contexts = new WeakMap<FastifyRequest, RequestContext>();

/** Writes every failure, including routing and body-parsing failures, as the stable API error body. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const header = reply.getHeader(REQUEST_ID_HEADER);
    const requestId = typeof header === 'string' ? header : currentContext()?.requestId ?? 'unavailable';
    const { status, body } = toApiError(exception, requestId);
    void reply.status(status).header('cache-control', 'no-store').send(body);
  }
}

/**
 * Installs request context and the error standard on a Nest/Fastify composition root. Must run
 * before `listen`/`init`. Context is entered on request and re-entered before the handler, because
 * body parsing may continue outside the original async scope.
 */
export function configureHttpPlatform(app: NestFastifyApplication, logger: Logger): void {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (request, reply, done) => {
    const context = contextFromHeaders(request.headers);
    contexts.set(request, context);
    void reply.header(REQUEST_ID_HEADER, context.requestId).header(CORRELATION_HEADER, context.correlationId);
    runWithContext(context, done);
  });
  fastify.addHook('preHandler', (request, _reply, done) => {
    const context = contexts.get(request);
    if (context) runWithContext(context, done); else done();
  });
  // One completion line per request; the query string is dropped because it may carry personal data.
  fastify.addHook('onResponse', (request, reply, done) => {
    const fields = { method: request.method, path: request.url.split('?')[0], statusCode: reply.statusCode, durationMs: Math.round(reply.elapsedTime) };
    const context = contexts.get(request);
    const log = () => logger.info('http.request.completed', fields);
    if (context) runWithContext(context, log); else log();
    done();
  });
  app.useGlobalFilters(new ApiExceptionFilter());
}
