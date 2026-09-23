export type Runtime = 'api' | 'worker' | 'edge';
export interface RuntimeConfig {
  readonly runtime: Runtime;
  readonly environment: 'local' | 'test';
  readonly host: '127.0.0.1';
  readonly port: number;
}

export class ConfigError extends Error {
  constructor(readonly field: string) {
    super(`Invalid configuration: ${field}`);
    this.name = 'ConfigError';
  }
}

/** Batch 1 intentionally has no production/provider configuration surface. */
export function loadConfig(runtime: Runtime, env: NodeJS.ProcessEnv): RuntimeConfig {
  const environment = env['RIFAD_ENV'] ?? 'local';
  if (environment !== 'local' && environment !== 'test') throw new ConfigError('RIFAD_ENV');
  if (env['RIFAD_RUNTIME'] !== undefined && env['RIFAD_RUNTIME'] !== runtime) throw new ConfigError('RIFAD_RUNTIME');
  if (env['RIFAD_HOST'] !== undefined && env['RIFAD_HOST'] !== '127.0.0.1') throw new ConfigError('RIFAD_HOST');
  const allowed = new Set(['RIFAD_ENV', 'RIFAD_RUNTIME', 'RIFAD_HOST', 'RIFAD_PORT']);
  if (Object.keys(env).some(key => key.startsWith('RIFAD_') && !allowed.has(key))) throw new ConfigError('unsupported RIFAD setting');
  if (env['NODE_ENV'] === 'production') throw new ConfigError('NODE_ENV');
  const defaults: Record<Runtime, number> = { api: 3000, edge: 3001, worker: 3002 };
  const rawPort = env['RIFAD_PORT'] ?? String(defaults[runtime]);
  if (!/^[1-9]\d{0,4}$/.test(rawPort) || Number(rawPort) > 65535) throw new ConfigError('RIFAD_PORT');
  return Object.freeze({ runtime, environment, host: '127.0.0.1', port: Number(rawPort) });
}
