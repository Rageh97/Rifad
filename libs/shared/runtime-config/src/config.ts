export type Runtime = 'api' | 'worker' | 'edge';
export interface RuntimeConfig {
  readonly runtime: Runtime;
  readonly environment: 'local' | 'test';
  readonly host: '127.0.0.1';
  readonly port: number;
  /** Cloud runtimes only; Edge never receives a Postgres connection (ADR-029/037). */
  readonly databaseUrl?: string;
}

export class ConfigError extends Error {
  constructor(readonly field: string) {
    super(`Invalid configuration: ${field}`);
    this.name = 'ConfigError';
  }
}

const cloudRuntimes: ReadonlySet<Runtime> = new Set(['api', 'worker']);
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Local/test databases only: a loopback postgres URL with explicit port, user and database. */
function databaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConfigError('RIFAD_DATABASE_URL'); }
  const valid = (url.protocol === 'postgres:' || url.protocol === 'postgresql:') && loopbackHosts.has(url.hostname)
    && /^[1-9]\d{0,4}$/.test(url.port) && Number(url.port) <= 65535 && /^[a-z_][a-z0-9_]{0,62}$/.test(decodeURIComponent(url.username))
    && /^\/[a-z_][a-z0-9_]{0,62}$/.test(url.pathname) && !url.search && !url.hash;
  if (!valid) throw new ConfigError('RIFAD_DATABASE_URL');
  return value;
}

/** No production/provider configuration surface yet: local and test environments only. */
export function loadConfig(runtime: Runtime, env: NodeJS.ProcessEnv): RuntimeConfig {
  const environment = env['RIFAD_ENV'] ?? 'local';
  if (environment !== 'local' && environment !== 'test') throw new ConfigError('RIFAD_ENV');
  if (env['RIFAD_RUNTIME'] !== undefined && env['RIFAD_RUNTIME'] !== runtime) throw new ConfigError('RIFAD_RUNTIME');
  if (env['RIFAD_HOST'] !== undefined && env['RIFAD_HOST'] !== '127.0.0.1') throw new ConfigError('RIFAD_HOST');
  const allowed = new Set(['RIFAD_ENV', 'RIFAD_RUNTIME', 'RIFAD_HOST', 'RIFAD_PORT', ...(cloudRuntimes.has(runtime) ? ['RIFAD_DATABASE_URL'] : [])]);
  if (Object.keys(env).some(key => key.startsWith('RIFAD_') && !allowed.has(key))) throw new ConfigError('unsupported RIFAD setting');
  if (env['NODE_ENV'] === 'production') throw new ConfigError('NODE_ENV');
  const defaults: Record<Runtime, number> = { api: 3000, edge: 3001, worker: 3002 };
  const rawPort = env['RIFAD_PORT'] ?? String(defaults[runtime]);
  if (!/^[1-9]\d{0,4}$/.test(rawPort) || Number(rawPort) > 65535) throw new ConfigError('RIFAD_PORT');
  const rawDatabase = env['RIFAD_DATABASE_URL'];
  return Object.freeze({
    runtime, environment, host: '127.0.0.1', port: Number(rawPort),
    ...(rawDatabase === undefined ? {} : { databaseUrl: databaseUrl(rawDatabase) }),
  });
}
