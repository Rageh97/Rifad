import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathName, loadTaskSpec, scopeResult, UsageLedger } from './policy.mjs';
import { childEnvironment, selectPinnedRuntime, findExecutable, nodeCliRunner, pnpmRunner, run } from './process.mjs';
import { createDetached, enforceScope, git, removeWorktree, snapshot, verifySnapshot } from './git.mjs';
import { runVerifier, runBuilder } from './agents.mjs';
import { validateDependencyRecords, validateProtection, validateVerifierProbe } from './preflight.mjs';
import { RunState } from './state.mjs';
import { execute } from './pipeline.mjs';

const root = join(import.meta.dirname, '../..');
const validSpec = {
  version: 1, taskId: 'M0-036.B', risk: 'STANDARD',
  objective: 'Add a synthetic engineering-only canary document.',
  acceptance: ['The approved path contains the canary text.'],
  allowedPaths: ['docs/engineering/canary.md'], baseSha: 'a'.repeat(40), baseBranch: 'main',
};

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'rifad-agent-test-'));
  return { dir, close: () => rmSync(dir, { recursive: true, force: true }) };
}

async function repository() {
  const f = fixture();
  const binary = findExecutable('git');
  await git(binary, f.dir, ['init', '-q']);
  await git(binary, f.dir, ['config', 'user.name', 'RIFAD Test']);
  await git(binary, f.dir, ['config', 'user.email', 'test@example.invalid']);
  writeFileSync(join(f.dir, 'file.txt'), 'baseline\n');
  writeFileSync(join(f.dir, '.gitignore'), 'runs/\n');
  await git(binary, f.dir, ['add', 'file.txt', '.gitignore']);
  await git(binary, f.dir, ['commit', '-qm', 'baseline']);
  const sha = (await git(binary, f.dir, ['rev-parse', 'HEAD'])).trim();
  const runs = join(f.dir, 'runs');
  mkdirSync(runs);
  return { ...f, binary, sha, runs };
}

test('task specification rejects traversal, wildcard, and malformed base', () => {
  assert.equal(loadTaskSpec(validSpec).risk, 'STANDARD');
  for (const path of ['../secret', 'C:/secret', '.git/config', 'docs/**/secret', 'docs\\secret']) {
    assert.throws(() => loadTaskSpec({ ...validSpec, allowedPaths: [path] }));
  }
  assert.throws(() => loadTaskSpec({ ...validSpec, baseBranch: '../main' }));
  assert.throws(() => pathName('docs/../secret'));
});

test('independent scope rejects unauthorized changes before staging', async () => {
  const f = await repository();
  try {
    writeFileSync(join(f.dir, 'file.txt'), 'authorized\n');
    writeFileSync(join(f.dir, 'secret.txt'), 'unauthorized\n');
    assert.deepEqual(scopeResult(['file.txt', 'secret.txt'], ['file.txt']).unauthorized, ['secret.txt']);
    await assert.rejects(enforceScope(f.binary, f.dir, ['file.txt']), error =>
      error.message === 'SCOPE_VIOLATION' && error.unauthorized.includes('secret.txt'));
    assert.equal((await git(f.binary, f.dir, ['diff', '--cached', '--name-only'])).trim(), '');
  } finally { f.close(); }
});

test('detached verifier worktree is exact SHA and tracks file and untracked mutations', async () => {
  const f = await repository();
  const worktree = join(f.runs, 'verifier');
  try {
    await createDetached(f.binary, f.dir, f.runs, worktree, f.sha);
    const before = await snapshot(f.binary, worktree);
    assert.equal(before.head, f.sha);
    assert.equal(verifySnapshot(before, await snapshot(f.binary, worktree), f.sha), true);
    writeFileSync(join(worktree, 'file.txt'), 'tampered\n');
    const trackedMutation = await snapshot(f.binary, worktree);
    assert.throws(() => verifySnapshot(before, trackedMutation, f.sha), /PROTOCOL_VIOLATION/);
    writeFileSync(join(worktree, 'file.txt'), 'baseline\n');
    writeFileSync(join(worktree, 'untracked.txt'), 'tampered\n');
    const untrackedMutation = await snapshot(f.binary, worktree);
    assert.throws(() => verifySnapshot(before, untrackedMutation, f.sha), /PROTOCOL_VIOLATION/);
  } finally {
    await removeWorktree(f.binary, f.dir, f.runs, worktree);
    f.close();
  }
});

test('verifier mutation is a protocol violation even with a PASS response', async () => {
  const f = await repository();
  const worktree = join(f.runs, 'verifier');
  try {
    await createDetached(f.binary, f.dir, f.runs, worktree, f.sha);
    const spec = { ...validSpec, baseSha: f.sha };
    await assert.rejects(runVerifier({
      binary: 'agy', gitBinary: f.binary, repository: f.dir, worktree, env: {}, runDir: f.runs,
      task: spec, candidateSha: f.sha, number: 1,
      invoke: async () => {
        writeFileSync(join(worktree, 'file.txt'), 'verifier mutation\n');
        return { code: 0, stdout: JSON.stringify({
          status: 'SUCCESS', structured_output: {
            candidateSha: f.sha, verdict: 'PASS', rationale: 'Looks fine', findings: [],
          }, usage: { total_tokens: 10 },
        }) };
      },
    }), /PROTOCOL_VIOLATION/);
    const evidence = JSON.parse(readFileSync(join(f.runs, 'verifier-1.json'), 'utf8'));
    assert.notEqual(evidence.before.trackedHash, evidence.after.trackedHash);
  } finally {
    await removeWorktree(f.binary, f.dir, f.runs, worktree);
    assert.equal(existsSync(worktree), false);
    f.close();
  }
});

test('verifier rejects a response for a different candidate SHA', async () => {
  const f = await repository();
  const worktree = join(f.runs, 'verifier');
  try {
    await createDetached(f.binary, f.dir, f.runs, worktree, f.sha);
    await assert.rejects(runVerifier({
      binary: 'agy', gitBinary: f.binary, repository: f.dir, worktree, env: {}, runDir: f.runs,
      task: { ...validSpec, baseSha: f.sha }, candidateSha: f.sha, number: 2,
      invoke: async () => ({ code: 0, stdout: JSON.stringify({
        status: 'SUCCESS', structured_output: {
          candidateSha: 'b'.repeat(40), verdict: 'PASS', rationale: 'Wrong SHA', findings: [],
        }, usage: { total_tokens: 10 },
      }) }),
    }), /VERIFIER_OUTPUT_INVALID/);
  } finally {
    await removeWorktree(f.binary, f.dir, f.runs, worktree);
    f.close();
  }
});

test('verifier mutation of the original repository is a protocol violation', async () => {
  const f = await repository();
  const worktree = join(f.runs, 'verifier');
  try {
    await createDetached(f.binary, f.dir, f.runs, worktree, f.sha);
    await assert.rejects(runVerifier({
      binary: 'agy', gitBinary: f.binary, repository: f.dir, worktree, env: {}, runDir: f.runs,
      task: { ...validSpec, baseSha: f.sha }, candidateSha: f.sha, number: 3,
      invoke: async () => {
        writeFileSync(join(f.dir, 'file.txt'), 'unauthorized original repository mutation\n');
        return { code: 0, stdout: JSON.stringify({
          status: 'SUCCESS', structured_output: {
            candidateSha: f.sha, verdict: 'PASS', rationale: 'False pass', findings: [],
          }, usage: { total_tokens: 10 },
        }) };
      },
    }), /PROTOCOL_VIOLATION/);
    const evidence = JSON.parse(readFileSync(join(f.runs, 'verifier-3.json'), 'utf8'));
    assert.notEqual(evidence.repositoryBefore.trackedHash, evidence.repositoryAfter.trackedHash);
  } finally {
    await removeWorktree(f.binary, f.dir, f.runs, worktree);
    f.close();
  }
});

test('Codex Builder command is noninteractive and contains no Git mutation capability', async () => {
  const f = fixture();
  try {
    const result = await runBuilder({
      binary: 'codex', worktree: f.dir, env: {}, runDir: f.dir, task: validSpec,
      invoke: async (_binary, args) => {
        assert.deepEqual(args.slice(0, 3), ['--ask-for-approval', 'never', 'exec']);
        assert.ok(args.includes('workspace-write'));
        assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
        writeFileSync(join(f.dir, 'builder-0.json'), '{"summary":"Done"}');
        return { code: 0, stdout: '{"type":"turn.completed","usage":{"total_tokens":12}}\n' };
      },
    });
    assert.equal(result.tokens, 12);
  } finally { f.close(); }
});

test('role environment drops unrelated secrets and selects pinned Node and pnpm', async () => {
  const runtime = selectPinnedRuntime(root);
  assert.equal(runtime.version, '24.21.0');
  const pnpm = pnpmRunner(runtime, findExecutable('pnpm'));
  const version = await run(pnpm.executable, [...pnpm.prefix, '--version'], { cwd: root, env: process.env });
  assert.equal(version.stdout.trim(), '11.19.0');
  const launcher = fixture();
  try {
    if (process.platform === 'win32') {
      const target = join(launcher.dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      mkdirSync(join(launcher.dir, 'node_modules', '@openai', 'codex', 'bin'), { recursive: true });
      writeFileSync(target, '');
      const command = join(launcher.dir, 'codex.cmd');
      writeFileSync(command, '"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\n');
      assert.deepEqual(nodeCliRunner(runtime, command, 'codex'), { executable: runtime.node, prefix: [target] });
    } else {
      assert.deepEqual(nodeCliRunner(runtime, runtime.node, 'codex'), { executable: runtime.node, prefix: [] });
    }
  } finally { launcher.close(); }
  const env = childEnvironment({ runtime, binaries: [findExecutable('git')], temporary: tmpdir(), role: 'verifier',
    source: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, USERPROFILE: process.env.USERPROFILE,
      APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA,
      GH_TOKEN: 'secret', OPENAI_API_KEY: 'secret', DATABASE_URL: 'secret', CODEX_HOME: 'secret' } });
  for (const key of ['GH_TOKEN', 'OPENAI_API_KEY', 'DATABASE_URL', 'CODEX_HOME']) assert.equal(env[key], undefined);
  assert.ok(env.PATH.startsWith(runtime.binDir));
});

test('budget soft review and hard stop, with finite fix rounds', () => {
  const ledger = new UsageLedger('STANDARD');
  assert.equal(ledger.policy.maxVerifyFix, 2);
  assert.equal(ledger.policy.maxCiFix, 2);
  ledger.add('builder', 50_000);
  assert.throws(() => ledger.beforeNext('builder', 10_000, false), /HUMAN_REVIEW_REQUIRED/);
  assert.equal(ledger.beforeNext('builder', 10_000, true).used, 50_000);
  assert.throws(() => ledger.add('builder', 30_001), /BUDGET_EXCEEDED/);
});

test('B001 closure and main protection are hard preflight gates', () => {
  const b001 = readFileSync(join(root, 'docs/work/batches/B001.md'), 'utf8');
  validateDependencyRecords(b001);
  assert.throws(() => validateDependencyRecords(b001.replace('Status: COMPLETE', 'Status: PENDING')), /B001_INCOMPLETE/);
  const protection = {
    required_status_checks: { strict: true, checks: ['quality (ubuntu-latest)', 'quality (windows-latest)'].map(context => ({ context, app_id: 15368 })) },
    enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false },
  };
  validateProtection(protection);
  assert.throws(() => validateProtection({ ...protection, allow_force_pushes: { enabled: true } }), /MAIN_UNPROTECTED/);
  assert.throws(() => validateProtection({ ...protection, required_status_checks: { strict: true, checks: [] } }), /REQUIRED_CHECK_MISSING/);
});

test('Windows verifier CLI probe rejects partial or unsuccessful structured output', () => {
  const result = { code: 0, timedOut: false, overflow: false };
  const valid = { status: 'SUCCESS', structured_output: { ok: true } };
  validateVerifierProbe(result, valid);
  for (const [candidate, output] of [
    [result, undefined],
    [result, { status: 'SUCCESS', structured_output: { ok: false } }],
    [{ ...result, timedOut: true }, valid],
  ]) assert.throws(() => validateVerifierProbe(candidate, output), /VERIFIER_PROBE_FAILED/);
});

test('state machine prevents skipping verification and terminal revival', () => {
  const f = fixture();
  try {
    const state = new RunState(join(f.dir, 'state.json'), 'TEST');
    state.to('PREFLIGHT');
    assert.throws(() => state.to('READY_FOR_APPROVAL'), /INVALID_TRANSITION/);
    state.to('BLOCKED');
    assert.throws(() => state.to('BUILDING'), /TERMINAL_STATE/);
  } finally { f.close(); }
});

test('orchestrator fails a mutating verifier and removes its disposable worktree', async () => {
  const f = await repository();
  const remote = join(f.dir, 'remote.git');
  try {
    writeFileSync(join(f.dir, '.gitignore'), '.agent-runs/\nremote.git/\n');
    await git(f.binary, f.dir, ['add', '.gitignore']);
    await git(f.binary, f.dir, ['commit', '-qm', 'ignore run evidence']);
    const baseSha = (await git(f.binary, f.dir, ['rev-parse', 'HEAD'])).trim();
    await git(f.binary, f.dir, ['init', '--bare', '-q', remote]);
    await git(f.binary, f.dir, ['remote', 'add', 'origin', remote]);
    await git(f.binary, f.dir, ['push', '-q', 'origin', baseSha + ':refs/heads/main']);
    const result = await execute(f.dir, { ...validSpec, baseSha, allowedPaths: ['canary.txt'] }, {
      preflight: async () => ({
        binaries: { git: f.binary, codex: 'codex', agy: 'agy', gh: 'gh' },
        pnpm: { executable: 'pnpm', prefix: [] }, gateEnv: {}, builderEnv: {}, verifierEnv: {},
        versions: { node: '24.21.0' }, repository: 'fixture/repo', origin: remote, windows: 'TESTED',
      }),
      gateInvoke: async () => ({ code: 0, stdout: '', stderr: '' }),
      builderInvoke: async (_binary, args) => {
        writeFileSync(join(args[args.indexOf('-C') + 1], 'canary.txt'), 'synthetic candidate\n');
        writeFileSync(args[args.indexOf('--output-last-message') + 1], '{"summary":"Synthetic canary"}');
        return { code: 0, stdout: '{"type":"turn.completed","usage":{"total_tokens":100}}\n' };
      },
      verifierInvoke: async (_binary, _args, options) => {
        writeFileSync(join(options.cwd, 'canary.txt'), 'unauthorized verifier mutation\n');
        return { code: 0, stdout: JSON.stringify({
          status: 'SUCCESS', structured_output: {
            candidateSha: (await git(f.binary, options.cwd, ['rev-parse', 'HEAD'])).trim(),
            verdict: 'PASS', rationale: 'False pass', findings: [],
          }, usage: { total_tokens: 100 },
        }) };
      },
      publishCandidate: async () => { throw new Error('mutated candidate must not publish'); },
    });
    assert.equal(result.status, 'PROTOCOL_VIOLATION');
    assert.match(result.reason, /PROTOCOL_VIOLATION/);
    assert.equal(existsSync(join(result.runDir, 'verifier-1')), false);
    assert.equal(existsSync(join(result.runDir, 'builder')), false);
    assert.equal((await git(f.binary, f.dir, ['status', '--porcelain'])).trim(), '');
  } finally { f.close(); }
});

test('CRITICAL flow binds verifier to committed candidate and uses a fresh final context', async () => {
  const f = await repository();
  const remote = join(f.dir, 'remote.git');
  let verifierCalls = 0, builderCalls = 0, publishedSha;
  try {
    writeFileSync(join(f.dir, '.gitignore'), '.agent-runs/\nremote.git/\n');
    await git(f.binary, f.dir, ['add', '.gitignore']);
    await git(f.binary, f.dir, ['commit', '-qm', 'ignore run evidence']);
    const baseSha = (await git(f.binary, f.dir, ['rev-parse', 'HEAD'])).trim();
    await git(f.binary, f.dir, ['init', '--bare', '-q', remote]);
    await git(f.binary, f.dir, ['remote', 'add', 'origin', remote]);
    await git(f.binary, f.dir, ['push', '-q', 'origin', baseSha + ':refs/heads/main']);
    const task = { ...validSpec, risk: 'CRITICAL', baseSha, allowedPaths: ['canary.txt'] };
    const result = await execute(f.dir, task, {
      preflight: async () => ({
        binaries: { git: f.binary, codex: 'codex', agy: 'agy', gh: 'gh' },
        pnpm: { executable: 'pnpm', prefix: [] }, gateEnv: {}, builderEnv: {}, verifierEnv: {},
        versions: { node: '24.21.0' }, repository: 'fixture/repo', origin: remote, windows: 'TESTED',
      }),
      gateInvoke: async () => ({ code: 0, stdout: '', stderr: '' }),
      builderInvoke: async (_binary, args) => {
        builderCalls++;
        const worktree = args[args.indexOf('-C') + 1];
        writeFileSync(join(worktree, 'canary.txt'), 'candidate ' + builderCalls + '\n');
        const output = args[args.indexOf('--output-last-message') + 1];
        writeFileSync(output, '{"summary":"Synthetic canary"}');
        return { code: 0, stdout: '{"type":"turn.completed","usage":{"total_tokens":100}}\n' };
      },
      verifierInvoke: async (_binary, args, options) => {
        verifierCalls++;
        const candidateSha = (await git(f.binary, options.cwd, ['rev-parse', 'HEAD'])).trim();
        assert.equal(args.includes('--conversation'), verifierCalls === 2);
        return { code: 0, stdout: JSON.stringify({
          status: 'SUCCESS', conversation_id: 'previous-verification',
          structured_output: {
            candidateSha, verdict: verifierCalls === 1 ? 'FAIL' : 'PASS',
            rationale: 'Synthetic independent verdict',
            findings: verifierCalls === 1 ? [{ path: 'canary.txt', message: 'Revise synthetic canary' }] : [],
          }, usage: { total_tokens: 100 },
        }) };
      },
      publishCandidate: async ({ candidateSha }) => {
        publishedSha = candidateSha;
        return 'https://github.com/fixture/repo/pull/1';
      },
      waitForCi: async ({ candidateSha }) => {
        assert.equal(candidateSha, publishedSha);
        return { status: 'PASSED', checks: [] };
      },
    });
    assert.equal(result.status, 'READY_FOR_APPROVAL');
    assert.equal(result.candidateSha, publishedSha);
    assert.equal(result.verifyFixRounds, 1);
    assert.equal(verifierCalls, 3);
    assert.equal(builderCalls, 2);
    assert.equal((await git(f.binary, f.dir, ['status', '--porcelain'])).trim(), '');
  } finally { f.close(); }
});
