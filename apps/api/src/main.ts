import 'reflect-metadata';
import { Controller, Get, Inject, Module, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AccessGuard, PublicRoute, RequirePermission, createAccessPipeline } from '@rifad/access';
import { postgresAuthorizationQuery } from '@rifad/authorization-infrastructure';
import { checkDatabase, createDatabase } from '@rifad/database';
import { postgresEntitlementQuery } from '@rifad/entitlements-infrastructure';
import { configureHttpPlatform, registerReadiness } from '@rifad/http-platform';
import { oidcTokenVerifier, postgresUserDirectory } from '@rifad/identity-infrastructure';
import { createLogger } from '@rifad/logging';
import { initTracing } from '@rifad/observability';
import type { OrganizationDirectory } from '@rifad/organizations-contract';
import { postgresOrganizationDirectory } from '@rifad/organizations-infrastructure';
import { requireContext } from '@rifad/request-context';
import { ConfigError, loadConfig } from '@rifad/runtime-config';

const ORGANIZATION_DIRECTORY = 'OrganizationDirectory';

@Controller()
class LivenessController {
  @PublicRoute()
  @Get('health/live')
  live() {
    return { status: 'alive', runtime: 'api', capability: 'batch-1-liveness-only' };
  }
}

/** First protected route: proves the full security pipeline (M0-016) end to end. */
@Controller('api/v1')
class OrganizationController {
  constructor(@Inject(ORGANIZATION_DIRECTORY) private readonly organizations: OrganizationDirectory) {}

  @RequirePermission('organizations.read')
  @Get('organization')
  async current() {
    // The tenant comes from the verified request context bound by AccessGuard, never from the header directly.
    const { organizationId } = requireContext();
    return this.organizations.findOrganization(organizationId ?? '');
  }
}

/** Protected controllers exist only when the security pipeline is configured; otherwise they are not registered at all. */
function apiModule(organizations: OrganizationDirectory | undefined): Type<unknown> {
  @Module({
    controllers: organizations ? [LivenessController, OrganizationController] : [LivenessController],
    providers: organizations ? [{ provide: ORGANIZATION_DIRECTORY, useValue: organizations }] : [],
  })
  class ApiRoot {}
  return ApiRoot;
}

const logger = createLogger({ runtime: 'api' });

async function bootstrap(): Promise<void> {
  const config = loadConfig('api', process.env);
  // Before the HTTP app so every request span and log line carries trace context (M0-024).
  const tracing = initTracing({ runtime: 'api', ...(config.otelExporterUrl ? { exporterUrl: config.otelExporterUrl } : {}) });
  // The pool connects lazily: an unreachable database affects readiness, never liveness or startup.
  const database = config.databaseUrl === undefined ? undefined : createDatabase(config.databaseUrl, { applicationName: 'rifad-api' });
  const secured = database && config.oidc;
  const organizations = secured ? postgresOrganizationDirectory(database.db) : undefined;
  // Framework logging stays disabled; the structured logger writes redacted JSON lines instead.
  const app = await NestFactory.create<NestFastifyApplication>(apiModule(organizations), new FastifyAdapter({ logger: false }), { logger: false });
  configureHttpPlatform(app, logger);
  if (database && config.oidc && organizations) {
    const pipeline = createAccessPipeline({
      tokens: oidcTokenVerifier(config.oidc), users: postgresUserDirectory(database.db), organizations,
      entitlements: postgresEntitlementQuery(database.db), authorization: postgresAuthorizationQuery(database.db),
    });
    // Global and default-deny: every route must be @PublicRoute or declare @RequirePermission.
    app.useGlobalGuards(new AccessGuard(pipeline));
  }
  registerReadiness(app, { database: async () => database ? checkDatabase(database.db) : 'not_configured' });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    await database?.close();
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
    await database?.close();
    await tracing.shutdown();
    throw new Error('LISTEN_FAILED');
  }
  logger.info('runtime.started', {
    environment: config.environment, host: config.host, port: config.port,
    database: database ? 'configured' : 'not_configured', access: secured ? 'enforced' : 'not_configured',
  });
}

void bootstrap().catch(error => {
  const code = error instanceof ConfigError ? 'INVALID_CONFIG' : 'STARTUP_FAILED';
  logger.error('runtime.failed', { code });
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
