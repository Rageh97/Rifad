import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from '@rifad/logging';
import { SpanKind, SpanStatusCode, contextFromTraceparent, otelContext, otelTrace, tracer, type Span } from '@rifad/observability';
import { CORRELATION_HEADER, REQUEST_ID_HEADER, contextFromHeaders, currentContext, runWithContext, type RequestContext } from '@rifad/request-context';
import { toApiError } from './api-error';

const contexts = new WeakMap<FastifyRequest, RequestContext>();
const spans = new WeakMap<FastifyRequest, Span>();

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
  // Runs `fn` inside both the request context and the request's server span (when tracing is on).
  const enter = (request: FastifyRequest, fn: () => void) => {
    const context = contexts.get(request);
    const span = spans.get(request);
    const inner = () => (context ? runWithContext(context, fn) : fn());
    if (span) otelContext.with(otelTrace.setSpan(otelContext.active(), span), inner); else inner();
  };
  fastify.addHook('onRequest', (request, reply, done) => {
    const context = contextFromHeaders(request.headers);
    contexts.set(request, context);
    // A caller's W3C traceparent continues its trace; a malformed one is ignored, never trusted.
    const header = request.headers['traceparent'];
    const parent = contextFromTraceparent(typeof header === 'string' ? header : undefined);
    const path = request.url.split('?')[0] ?? '/';
    spans.set(request, tracer().startSpan(`HTTP ${request.method}`, {
      kind: SpanKind.SERVER, attributes: { 'http.request.method': request.method, 'url.path': path, 'rifad.request_id': context.requestId },
    }, parent));
    void reply.header(REQUEST_ID_HEADER, context.requestId).header(CORRELATION_HEADER, context.correlationId);
    enter(request, done);
  });
  fastify.addHook('preHandler', (request, _reply, done) => enter(request, done));
  // One completion line per request; the query string is dropped because it may carry personal data.
  fastify.addHook('onResponse', (request, reply, done) => {
    const fields = { method: request.method, path: request.url.split('?')[0], statusCode: reply.statusCode, durationMs: Math.round(reply.elapsedTime) };
    enter(request, () => logger.info('http.request.completed', fields));
    const span = spans.get(request);
    if (span) {
      span.setAttribute('http.response.status_code', reply.statusCode);
      if (reply.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }
    done();
  });
  app.useGlobalFilters(new ApiExceptionFilter());
}
