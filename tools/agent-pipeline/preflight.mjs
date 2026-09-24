import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { childEnvironment, findExecutable, nodeCliRunner, pnpmRunner, run, selectPinnedRuntime } from './process.mjs';
import { createDetached, git, removeWorktree, snapshot, verifySnapshot } from './git.mjs';

const requiredChecks = ['quality (ubuntu-latest)', 'quality (windows-latest)'];

function requireOutput(result, code) {
  if (result.code !== 0 || result.timedOut || result.overflow) throw new Error(code);
  return result.stdout;
}

export function validateDependencyRecords(b001) {
  if (!/^Status: COMPLETE$/m.test(b001)) throw new Error('BLOCKED: B001_INCOMPLETE');
  for (const task of ['M0-036.a', 'M0-038.a', 'M0-054.a']) {
    const escaped = task.replace('.', '\\.');
    if (!new RegExp(`^\\| ${escaped} \\|[^\\n]*\\| COMPLETE \\|$`, 'm').test(b001)) throw new Error('BLOCKED: DEPENDENCY_INCOMPLETE: ' + task);
  }
}

export function validateProtection(value) {
  const checks = value?.required_status_checks?.checks ?? [];
  if (value?.required_status_checks?.strict !== true || value?.enforce_admins?.enabled !== true || value?.allow_force_pushes?.enabled !== false || value?.allow_deletions?.enabled !== false) throw new Error('BLOCKED: MAIN_UNPROTECTED');
  if (requiredChecks.some(name => !checks.some(check => check.context === name && check.app_id === 15368))) throw new Error('BLOCKED: REQUIRED_CHECK_MISSING');
}

export function validateVerifierProbe(result, parsed) {
  if (result.code !== 0 || result.timedOut || result.overflow ||
      parsed?.status !== 'SUCCESS' || parsed.structured_output?.ok !== true) {
    throw new Error('BLOCKED: VERIFIER_PROBE_FAILED');
  }
}

export async function preflight(root, temporary, { liveProbe = true } = {}) {
  validateDependencyRecords(readFileSync(join(root, 'docs/work/batches/B001.md'), 'utf8'));
  const runtime = selectPinnedRuntime(root);
  if (process.version !== 'v' + runtime.version) throw new Error('BLOCKED: RUNTIME_MISMATCH');
  const binaries = Object.fromEntries(['git', 'pnpm', 'codex', 'agy', 'gh'].map(name => [name, findExecutable(name, runtime.binDir + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH ?? ''))]));
  const pnpm = pnpmRunner(runtime, binaries.pnpm);
  const codex = nodeCliRunner(runtime, binaries.codex, 'codex');
  const agentBins = [binaries.git, binaries.pnpm, binaries.codex, binaries.agy];
  const builderEnv = childEnvironment({ runtime, binaries: agentBins, temporary, role: 'builder' });
  const verifierEnv = childEnvironment({ runtime, binaries: agentBins, temporary, role: 'verifier' });
  const gateEnv = childEnvironment({ runtime, binaries: agentBins, temporary, role: 'gate' });
  const version = {};
  for (const [name, args] of [['git', ['--version']], ['pnpm', ['--version']], ['codex', ['--version']], ['agy', ['--version']], ['gh', ['--version']]]) {
    const env = name === 'codex' ? builderEnv : name === 'agy' ? verifierEnv : name === 'gh' ? process.env : gateEnv;
    const runner = name === 'pnpm' ? pnpm : name === 'codex' ? codex : { executable: binaries[name], prefix: [] };
    version[name] = requireOutput(await run(runner.executable, [...runner.prefix, ...args], { cwd: root, env, timeoutMs: 15_000 }), 'BLOCKED: UNSUPPORTED_CLI_VERSION: ' + name).trim().split('\n')[0];
  }
  const [codexHelp, codexGlobalHelp, agyHelp, worktreeHelp, ghPrHelp, ghApiHelp] = await Promise.all([
    run(codex.executable, [...codex.prefix, 'exec', '--help'], { cwd: root, env: builderEnv }),
    run(codex.executable, [...codex.prefix, '--help'], { cwd: root, env: builderEnv }),
    run(binaries.agy, ['--help'], { cwd: root, env: verifierEnv }),
    run(binaries.git, ['worktree', 'add', '-h'], { cwd: root, env: gateEnv }),
    run(binaries.gh, ['pr', 'create', '--help'], { cwd: root, env: process.env }),
    run(binaries.gh, ['api', '--help'], { cwd: root, env: process.env }),
  ]);
  for (const flag of ['--json', '--output-schema', '--output-last-message', '--sandbox', '--ignore-user-config']) if (!codexHelp.stdout.includes(flag)) throw new Error('BLOCKED: UNSUPPORTED_CLI_VERSION: codex ' + flag);
  if (!codexGlobalHelp.stdout.includes('--approve-for-me')) throw new Error('BLOCKED: UNSUPPORTED_CLI_VERSION: codex approval');
  for (const flag of ['--print', '--output-format', '--json-schema', '--conversation', '--disable-slash-commands']) if (!(agyHelp.stdout + agyHelp.stderr).includes(flag)) throw new Error('BLOCKED: UNSUPPORTED_CLI_VERSION: agy ' + flag);
  if (!(worktreeHelp.stdout + worktreeHelp.stderr).includes('--detach')) throw new Error('BLOCKED: UNSUPPORTED_CLI_VERSION: git worktree');
  if (!ghPrHelp.stdout.includes('--body-file') || !ghPrHelp.stdout.includes('--head') || !ghApiHelp.stdout.includes('api')) throw new Error('BLOCKED: UNSUPPORTED_CLI_VERSION: gh');
  const codexAuth = await run(codex.executable, [...codex.prefix, 'login', 'status'], { cwd: root, env: builderEnv, timeoutMs: 15_000 });
  if (codexAuth.code !== 0 || !(codexAuth.stdout + codexAuth.stderr).includes('Logged in')) throw new Error('BLOCKED: AUTHENTICATION_REQUIRED: codex');
  const agyAuth = await run(binaries.agy, ['models'], { cwd: root, env: verifierEnv, timeoutMs: 45_000 });
  if (agyAuth.code !== 0 || !agyAuth.stdout.trim()) throw new Error('BLOCKED: AUTHENTICATION_REQUIRED: agy');
  const ghAuth = await run(binaries.gh, ['auth', 'status'], { cwd: root, env: process.env, timeoutMs: 20_000 });
  if (ghAuth.code !== 0 || !(ghAuth.stdout + ghAuth.stderr).includes('Logged in')) throw new Error('BLOCKED: AUTHENTICATION_REQUIRED: gh');
  const remote = (await git(binaries.git, root, ['remote', 'get-url', 'origin'])).trim();
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote);
  if (!match) throw new Error('BLOCKED: REPOSITORY_REMOTE');
  const repository = match[1];
  const head = (await git(binaries.git, root, ['rev-parse', 'HEAD'])).trim();
  if ((await git(binaries.git, root, ['status', '--porcelain=v2', '-z'])) !== '') throw new Error('BLOCKED: DIRTY_ORCHESTRATOR');
  const protection = JSON.parse(requireOutput(await run(binaries.gh, ['api', `repos/${repository}/branches/main/protection`], { cwd: root, env: process.env, timeoutMs: 20_000 }), 'BLOCKED: MAIN_UNPROTECTED'));
  validateProtection(protection);
  const b001Sha = '0ac98fdab7779d41a1c184d0a9c0fb93c6e1d2ef';
  const checks = JSON.parse(requireOutput(await run(binaries.gh, ['api', `repos/${repository}/commits/${b001Sha}/check-runs`], { cwd: root, env: process.env, timeoutMs: 20_000 }), 'BLOCKED: B001_CI'));
  if (requiredChecks.some(name => !checks.check_runs?.some(check => check.name === name && check.conclusion === 'success' && check.app?.id === 15368))) throw new Error('BLOCKED: B001_CI');
  let windows = 'NOT_TESTED';
  if (liveProbe) {
    const runRoot = dirname(temporary);
    const worktree = join(runRoot, 'preflight-verifier');
    await createDetached(binaries.git, root, runRoot, worktree, head);
    try {
      const before = await snapshot(binaries.git, worktree);
      const repositoryBefore = await snapshot(binaries.git, root);
      const schema = JSON.stringify({ type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false });
      const probe = await run(binaries.agy, ['--disable-slash-commands', '--print', 'Return {"ok":true}. Do not call tools or inspect files.', '--output-format', 'json', '--json-schema', schema, '--print-timeout', '30s'], { cwd: worktree, env: verifierEnv, timeoutMs: 45_000 });
      const after = await snapshot(binaries.git, worktree);
      const repositoryAfter = await snapshot(binaries.git, root);
      verifySnapshot(before, after, head);
      verifySnapshot(repositoryBefore, repositoryAfter, head);
      let parsed;
      try { parsed = JSON.parse(probe.stdout); } catch { /* Fail closed below. */ }
      validateVerifierProbe(probe, parsed);
      windows = 'WINDOWS_CLI_PROBE_AND_REPOSITORY_INTEGRITY_PASSED_NO_OS_CONTAINMENT';
    } finally {
      await removeWorktree(binaries.git, root, runRoot, worktree);
    }
  }
  return { runtime, binaries, pnpm, codex, builderEnv, verifierEnv, gateEnv, versions: { node: runtime.version, ...version }, repository, origin: remote, head, windows };
}
