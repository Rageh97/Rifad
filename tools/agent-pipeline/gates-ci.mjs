import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.mjs';
import { run } from './process.mjs';

const checks = ['quality (ubuntu-latest)', 'quality (windows-latest)'];

export async function runGates({ pnpm, worktree, env, storeDir, install = false, invoke = run }) {
  const commands = install
    ? [['install', '--frozen-lockfile', '--store-dir', storeDir], ['check'], ['check:security']]
    : [['check'], ['check:security']];
  for (const command of commands) {
    const result = await invoke(pnpm.executable, [...pnpm.prefix, ...command], { cwd: worktree, env, timeoutMs: command[0] === 'check' ? 15 * 60_000 : 5 * 60_000 });
    if (result.code !== 0 || result.timedOut || result.overflow) throw Object.assign(new Error('DETERMINISTIC_GATE_FAILED'), { command: command[0], output: (result.stdout + result.stderr).slice(-4000) });
  }
}

async function gh(binary, root, args, timeoutMs = 30_000) {
  const result = await run(binary, args, { cwd: root, env: process.env, timeoutMs });
  if (result.code !== 0 || result.timedOut || result.overflow) throw new Error('BLOCKED: GITHUB_FAILED: ' + (result.stderr || result.stdout).slice(0, 300));
  return result.stdout.trim();
}

export async function publishCandidate({ gitBinary, ghBinary, worktree, root, runDir, task, candidateSha, branch, repository, previousPr }) {
  const head = (await git(gitBinary, worktree, ['rev-parse', 'HEAD'])).trim();
  if (head !== candidateSha) throw new Error('CANDIDATE_SHA_MISMATCH');
  await git(gitBinary, worktree, ['push', 'origin', `${candidateSha}:refs/heads/${branch}`], 120_000);
  if (previousPr) return previousPr;
  const bodyPath = join(runDir, 'pr-body.md');
  writeFileSync(bodyPath, [
    `${task.taskId}: ${task.objective}`,
    '',
    `Risk: ${task.risk}. Candidate: \`${candidateSha}\`.`,
    '',
    'Acceptance:',
    ...task.acceptance.map(item => `- ${item}`),
    '',
    'The orchestrator ran local deterministic gates, independent verification where required, and will inspect the Windows/Ubuntu CI checks. This pipeline never merges the PR.',
  ].join('\n') + '\n');
  const url = await gh(ghBinary, root, ['pr', 'create', '--repo', repository, '--base', task.baseBranch, '--head', branch, '--title', `${task.taskId}: approved agent candidate`, '--body-file', bodyPath]);
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url)) throw new Error('BLOCKED: PR_URL_INVALID');
  return url;
}

export async function waitForCi({ ghBinary, root, repository, candidateSha, timeoutMs = 20 * 60_000, readChecks = gh }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = JSON.parse(await readChecks(ghBinary, root, ['api', `repos/${repository}/commits/${candidateSha}/check-runs`], 30_000));
    const matching = checks.map(name => result.check_runs?.filter(check => check.name === name && check.app?.id === 15368).at(-1));
    if (matching.every(Boolean)) {
      const failed = matching.filter(check => check.status === 'completed' && check.conclusion !== 'success');
      if (failed.length) return { status: 'FAILED', checks: matching.map(check => ({ name: check.name, conclusion: check.conclusion, url: check.details_url })) };
      if (matching.every(check => check.status === 'completed' && check.conclusion === 'success')) return { status: 'PASSED', checks: matching.map(check => ({ name: check.name, conclusion: check.conclusion, url: check.details_url })) };
    }
    await new Promise(resolve => setTimeout(resolve, 15_000));
  }
  throw new Error('BLOCKED: CI_TIMEOUT');
}
