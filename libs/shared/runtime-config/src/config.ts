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
}

export class ConfigError extends Error {
  constructor(readonly field: string) {
    super(`Invalid configuration: ${field}`);
    this.name = 'ConfigError';
  }
}

const settingsByRuntime: Record<Runtime, readonly string[]> = {
  api: ['RIFAD_DATABASE_URL'],
  worker: ['RIFAD_DATABASE_URL', 'RIFAD_RELAY_DATABASE_URL', 'RIFAD_QUEUE_REDIS_URL'],
  edge: [],
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
  return Object.freeze({
    runtime, environment, host: '127.0.0.1' as const, port: Number(rawPort),
    ...optional('databaseUrl', 'RIFAD_DATABASE_URL', databaseUrl),
    ...optional('relayDatabaseUrl', 'RIFAD_RELAY_DATABASE_URL', databaseUrl),
    ...optional('queueRedisUrl', 'RIFAD_QUEUE_REDIS_URL', redisUrl),
  });
}
