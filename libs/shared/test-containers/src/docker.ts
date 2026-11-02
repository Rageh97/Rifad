import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const secret = () => randomBytes(18).toString('hex');

export async function docker(args: string[], timeout = 120_000): Promise<string> {
  try {
    return (await run('docker', args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 })).stdout.trim();
  } catch (error) {
    const reason = (error as { code?: unknown }).code === 'ENOENT' ? 'DOCKER_CLI_MISSING' : 'DOCKER_COMMAND_FAILED';
    throw new Error(`${reason}: docker ${args[0]} (integration tests require a running Docker engine)`);
  }
}

/** Host port Docker mapped to a container port on 127.0.0.1. */
export async function mappedPort(container: string, containerPort: string): Promise<number> {
  const mapping = await docker(['port', container, containerPort]);
  const port = Number(/:(\d+)\s*$/m.exec(mapping.split('\n')[0] ?? '')?.[1]);
  if (!Number.isInteger(port)) throw new Error('DOCKER_PORT_UNAVAILABLE');
  return port;
}

export async function waitFor(probe: () => Promise<void>, timeoutMs: number, code: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { await probe(); return; }
    catch { if (Date.now() > deadline) throw new Error(code); }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
