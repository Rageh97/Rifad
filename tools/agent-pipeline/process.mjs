import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, delimiter, resolve } from 'node:path';

const maxOutput = 2 * 1024 * 1024;

export function selectPinnedRuntime(root) {
  const pin = readFileSync(join(root, '.node-version'), 'utf8').trim();
  const local = join(root, '.tools', 'package', 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
  const node = existsSync(local) ? local : process.execPath;
  const version = spawnSync(node, ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (version.status !== 0 || version.stdout.trim() !== 'v' + pin) throw new Error('BLOCKED: RUNTIME_MISMATCH');
  return { node, version: pin, binDir: dirname(node) };
}

export function findExecutable(name, pathValue = process.env.PATH ?? '') {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const path = join(directory, name + extension);
      if (existsSync(path)) return resolve(path);
    }
  }
  throw new Error('BLOCKED: DEPENDENCY_MISSING: ' + name);
}

export function nodeCliRunner(runtime, launcherPath, entryName) {
  if (process.platform !== 'win32' || extname(launcherPath).toLowerCase() !== '.cmd') return { executable: launcherPath, prefix: [] };
  if (!['pnpm', 'codex'].includes(entryName)) throw new Error('INVALID_CLI_ENTRY');
  const script = readFileSync(launcherPath, 'utf8');
  const match = new RegExp('"([^"\\r\\n]+' + entryName + '\\.(?:mjs|cjs|js))"', 'i').exec(script);
  const target = match && match[1].replace(/%~dp0|%dp0%/gi, dirname(launcherPath) + '\\');
  const modulePath = target && resolve(target);
  if (!modulePath || !existsSync(modulePath)) throw new Error('BLOCKED: UNSUPPORTED_CLI_VERSION: ' + entryName + ' launcher');
  return { executable: runtime.node, prefix: [modulePath] };
}

export function pnpmRunner(runtime, pnpmPath) {
  return nodeCliRunner(runtime, pnpmPath, 'pnpm');
}

export function childEnvironment({ runtime, binaries, temporary, role, source = process.env }) {
  if (!['builder', 'verifier', 'gate', 'github'].includes(role)) throw new Error('INVALID_ENV_ROLE');
  const env = Object.create(null);
  const common = process.platform === 'win32'
    ? ['SystemRoot', 'WINDIR', 'PATHEXT', 'ComSpec', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
    : ['HOME', 'LANG', 'LC_ALL'];
  for (const key of common) if (source[key]) env[key] = source[key];
  const dirs = [runtime.binDir, ...binaries.map(dirname)];
  if (process.platform === 'win32' && source.SystemRoot) dirs.push(join(source.SystemRoot, 'System32'), source.SystemRoot);
  else dirs.push('/usr/bin', '/bin');
  env.PATH = [...new Set(dirs)].join(delimiter);
  env.TEMP = temporary;
  env.TMP = temporary;
  if (role === 'builder' && source.CODEX_HOME) env.CODEX_HOME = source.CODEX_HOME;
  if (role === 'gate') {
    env.NX_DAEMON = 'false';
    env.NX_ISOLATE_PLUGINS = 'false';
  }
  if (role === 'github') {
    // GitHub authentication stays with the orchestrator-owned gh process.
    if (source.GH_CONFIG_DIR) env.GH_CONFIG_DIR = source.GH_CONFIG_DIR;
  }
  return env;
}

export async function run(executable, args, { cwd, env, timeoutMs = 120_000, input = undefined } = {}) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new Error('INVALID_ARGS');
  return await new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, overflow = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    const append = (kind, chunk) => {
      if (kind === 'stdout') stdout += chunk;
      else stderr += chunk;
      if (stdout.length + stderr.length > maxOutput) { overflow = true; child.kill(); }
    };
    child.stdout.setEncoding('utf8').on('data', chunk => append('stdout', chunk));
    child.stderr.setEncoding('utf8').on('data', chunk => append('stderr', chunk));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolveResult({ code, signal, stdout, stderr, timedOut, overflow });
    });
    child.stdin.end(input);
  });
}

export async function checked(executable, args, options) {
  const result = await run(executable, args, options);
  if (result.timedOut) throw new Error('PROCESS_TIMEOUT');
  if (result.overflow) throw new Error('PROCESS_OUTPUT_LIMIT');
  if (result.code !== 0) throw new Error('PROCESS_FAILED: ' + (result.stderr || result.stdout).trim().slice(0, 500));
  return result.stdout;
}
