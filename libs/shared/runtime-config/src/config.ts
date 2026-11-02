export type Runtime = 'api' | 'worker' | 'edge';
export interface RuntimeConfig {
  readonly runtime: Runtime;
  readonly environment: 'local' | 'test';
  readonly host: '127.0.0.1';
  readonly port: number;
  /** Cloud runtimes only; Edge never receives a Postgres connection (ADR-029/037). */
  readonly databaseUrl?: string;
  /** Worker only: the scoped outbox relay role's connection (§14.1). */
  readonly relayDatabaseUrl?: string;
  /** Worker only: dedicated queue Redis; Edge never uses BullMQ/Redis (ADR-041). */
  readonly queueRedisUrl?: string;
  /** Optional local OTLP/HTTP traces endpoint (M0-024); exporting stays off without it. */
  readonly otelExporterUrl?: string;
  /** API only: provider-neutral OIDC settings (G12); all three or none. */
  readonly oidc?: { readonly issuer: string; readonly audience: string; readonly jwksUrl: string };
}

export class ConfigError extends Error {
  constructor(readonly field: string) {
    super(`Invalid configuration: ${field}`);
    this.name = 'ConfigError';
  }
}

const settingsByRuntime: Record<Runtime, readonly string[]> = {
  api: ['RIFAD_DATABASE_URL', 'RIFAD_OTEL_EXPORTER_URL', 'RIFAD_OIDC_ISSUER', 'RIFAD_OIDC_AUDIENCE', 'RIFAD_OIDC_JWKS_URL'],
  worker: ['RIFAD_DATABASE_URL', 'RIFAD_RELAY_DATABASE_URL', 'RIFAD_QUEUE_REDIS_URL', 'RIFAD_OTEL_EXPORTER_URL'],
  edge: ['RIFAD_OTEL_EXPORTER_URL'],
};
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const explicitPort = (url: URL) => /^[1-9]\d{0,4}$/.test(url.port) && Number(url.port) <= 65535;

/** Local/test databases only: a loopback postgres URL with explicit port, user and database. */
function databaseUrl(field: string, value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConfigError(field); }
  const valid = (url.protocol === 'postgres:' || url.protocol === 'postgresql:') && loopbackHosts.has(url.hostname)
    && explicitPort(url) && /^[a-z_][a-z0-9_]{0,62}$/.test(decodeURIComponent(url.username))
    && /^\/[a-z_][a-z0-9_]{0,62}$/.test(url.pathname) && !url.search && !url.hash;
  if (!valid) throw new ConfigError(field);
  return value;
}

/** Local/test queue Redis only: loopback, explicit port, optional database index 0-15. */
function redisUrl(field: string, value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConfigError(field); }
  const valid = url.protocol === 'redis:' && loopbackHosts.has(url.hostname) && explicitPort(url)
    && /^(?:\/(?:[0-9]|1[0-5])?)?$/.test(url.pathname) && !url.search && !url.hash;
  if (!valid) throw new ConfigError(field);
  return value;
}

/** Local collector only: http(s) loopback with explicit port; no credentials, query or fragment. */
function exporterUrl(field: string, value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConfigError(field); }
  const valid = (url.protocol === 'http:' || url.protocol === 'https:') && loopbackHosts.has(url.hostname) && explicitPort(url)
    && !url.username && !url.password && !url.search && !url.hash;
  if (!valid) throw new ConfigError(field);
  return value;
}

/** OIDC issuer/JWKS: https, or http on loopback for local test providers; no credentials, query or fragment. */
function oidcUrl(field: string, value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConfigError(field); }
  const valid = (url.protocol === 'https:' || (url.protocol === 'http:' && loopbackHosts.has(url.hostname)))
    && !url.username && !url.password && !url.search && !url.hash && value.length <= 500;
  if (!valid) throw new ConfigError(field);
  return value;
}

function oidcSettings(env: NodeJS.ProcessEnv): RuntimeConfig['oidc'] | undefined {
  const issuer = env['RIFAD_OIDC_ISSUER'];
  const audience = env['RIFAD_OIDC_AUDIENCE'];
  const jwksUrl = env['RIFAD_OIDC_JWKS_URL'];
  if (issuer === undefined && audience === undefined && jwksUrl === undefined) return undefined;
  if (issuer === undefined || audience === undefined || jwksUrl === undefined) throw new ConfigError('RIFAD_OIDC_*');
  if (!/^[A-Za-z0-9._:/-]{1,200}$/.test(audience)) throw new ConfigError('RIFAD_OIDC_AUDIENCE');
  return Object.freeze({ issuer: oidcUrl('RIFAD_OIDC_ISSUER', issuer), audience, jwksUrl: oidcUrl('RIFAD_OIDC_JWKS_URL', jwksUrl) });
}

/** No production/provider configuration surface yet: local and test environments only. */
export function loadConfig(runtime: Runtime, env: NodeJS.ProcessEnv): RuntimeConfig {
  const environment = env['RIFAD_ENV'] ?? 'local';
  if (environment !== 'local' && environment !== 'test') throw new ConfigError('RIFAD_ENV');
  if (env['RIFAD_RUNTIME'] !== undefined && env['RIFAD_RUNTIME'] !== runtime) throw new ConfigError('RIFAD_RUNTIME');
  if (env['RIFAD_HOST'] !== undefined && env['RIFAD_HOST'] !== '127.0.0.1') throw new ConfigError('RIFAD_HOST');
  const allowed = new Set(['RIFAD_ENV', 'RIFAD_RUNTIME', 'RIFAD_HOST', 'RIFAD_PORT', ...settingsByRuntime[runtime]]);
  if (Object.keys(env).some(key => key.startsWith('RIFAD_') && !allowed.has(key))) throw new ConfigError('unsupported RIFAD setting');
  if (env['NODE_ENV'] === 'production') throw new ConfigError('NODE_ENV');
  const defaults: Record<Runtime, number> = { api: 3000, edge: 3001, worker: 3002 };
  const rawPort = env['RIFAD_PORT'] ?? String(defaults[runtime]);
  if (!/^[1-9]\d{0,4}$/.test(rawPort) || Number(rawPort) > 65535) throw new ConfigError('RIFAD_PORT');
  const optional = <K extends string>(key: K, field: string, parse: (field: string, value: string) => string) => {
    const value = env[field];
    return (value === undefined ? {} : { [key]: parse(field, value) }) as Partial<Record<K, string>>;
  };
  const oidc = runtime === 'api' ? oidcSettings(env) : undefined;
  return Object.freeze({
    runtime, environment, host: '127.0.0.1' as const, port: Number(rawPort),
    ...optional('databaseUrl', 'RIFAD_DATABASE_URL', databaseUrl),
    ...optional('relayDatabaseUrl', 'RIFAD_RELAY_DATABASE_URL', databaseUrl),
    ...optional('queueRedisUrl', 'RIFAD_QUEUE_REDIS_URL', redisUrl),
    ...optional('otelExporterUrl', 'RIFAD_OTEL_EXPORTER_URL', exporterUrl),
    ...(oidc ? { oidc } : {}),
  });
}
