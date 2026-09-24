import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runBuilder, runVerifier } from './agents.mjs';
import { runGates, publishCandidate, waitForCi } from './gates-ci.mjs';
import { changedPaths, commitCandidate, createDetached, enforceScope, git, removeWorktree } from './git.mjs';
import { loadTaskSpec, UsageLedger } from './policy.mjs';
import { preflight } from './preflight.mjs';
import { RunState } from './state.mjs';

function safeId(value) { return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'); }
function terminalCode(error) {
  const message = String(error?.message ?? error);
  if (message.startsWith('SCOPE_VIOLATION')) return 'SCOPE_VIOLATION';
  if (message.startsWith('PROTOCOL_VIOLATION') || message === 'BUILDER_GIT_MUTATION') return 'PROTOCOL_VIOLATION';
  if (message === 'BUDGET_EXCEEDED') return 'BUDGET_EXCEEDED';
  if (message.startsWith('HUMAN_REVIEW_REQUIRED')) return 'HUMAN_REVIEW_REQUIRED';
  return 'BLOCKED';
}

export async function execute(root, taskInput, hooks = {}) {
  const task = loadTaskSpec(taskInput);
  const runsRoot = resolve(root, '.agent-runs');
  mkdirSync(runsRoot, { recursive: true });
  const runDir = mkdtempSync(join(runsRoot, safeId(task.taskId) + '-'));
  const temporary = join(runDir, 'tmp');
  mkdirSync(temporary);
  const state = new RunState(join(runDir, 'state.json'), task.taskId);
  const ledger = new UsageLedger(task.risk);
  const builderWorktree = join(runDir, 'builder');
  let tools, candidateSha, prUrl, ciResult, verifyFix = 0, ciFix = 0, verifierCount = 0, builderRound = 0;
  let feedback = '', conversationId, builderCreated = false;
  const branch = `codex/agent-${safeId(task.taskId)}-${runDir.split(/[\\/]/).at(-1).slice(-8)}`;
  const record = () => {
    const result = { status: state.value, taskId: task.taskId, runDir, candidateSha: candidateSha ?? null,
      prUrl: prUrl ?? null, ci: ciResult ?? null, tokens: ledger.used, softReviews: ledger.softReviews,
      verifyFixRounds: verifyFix, ciFixRounds: ciFix };
    writeFileSync(join(runDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  };
  try {
    state.to('PREFLIGHT');
    tools = await (hooks.preflight ?? preflight)(root, temporary);
    writeFileSync(join(runDir, 'preflight.json'), JSON.stringify({ versions: tools.versions, repository: tools.repository, origin: tools.origin, windows: tools.windows }, null, 2) + '\n');
    const base = (await git(tools.binaries.git, root, ['rev-parse', `origin/${task.baseBranch}`])).trim();
    if (base !== task.baseSha) throw new Error('BLOCKED: STALE_BASE');
    await createDetached(tools.binaries.git, root, runDir, builderWorktree, task.baseSha);
    builderCreated = true;
    await runGates({ pnpm: tools.pnpm, worktree: builderWorktree, env: tools.gateEnv, storeDir: join(root, '.pnpm-store'), install: true, invoke: hooks.gateInvoke });
    let progress = true;
    for (;;) {
      state.to('BUILDING', { round: builderRound });
      ledger.beforeNext('builder', 10_000, progress);
      const builderHeadBefore = (await git(tools.binaries.git, builderWorktree, ['rev-parse', 'HEAD'])).trim();
      const refsBefore = await git(tools.binaries.git, root, ['for-each-ref', '--format=%(refname) %(objectname)']);
      const builder = await runBuilder({ binary: tools.codex?.executable ?? tools.binaries.codex, prefix: tools.codex?.prefix ?? [], worktree: builderWorktree, env: tools.builderEnv, runDir, task, feedback, round: builderRound++, invoke: hooks.builderInvoke });
      ledger.add('builder', builder.tokens);
      const builderHeadAfter = (await git(tools.binaries.git, builderWorktree, ['rev-parse', 'HEAD'])).trim();
      const refsAfter = await git(tools.binaries.git, root, ['for-each-ref', '--format=%(refname) %(objectname)']);
      if (builderHeadBefore !== builderHeadAfter || refsBefore !== refsAfter) throw new Error('BUILDER_GIT_MUTATION');
      state.to('GATING');
      const paths = await enforceScope(tools.binaries.git, builderWorktree, task.allowedPaths);
      await runGates({ pnpm: tools.pnpm, worktree: builderWorktree, env: tools.gateEnv, storeDir: join(root, '.pnpm-store'), invoke: hooks.gateInvoke });
      candidateSha = await commitCandidate(tools.binaries.git, builderWorktree, paths, task.taskId);
      state.to('CANDIDATE', { sha: candidateSha, paths });
      let verdict = { verdict: 'PASS' };
      if (task.risk !== 'LOW') {
        state.to('VERIFYING', { sha: candidateSha });
        const verifyOnce = async (fresh = false) => {
          const target = join(runDir, `verifier-${++verifierCount}`);
          await createDetached(tools.binaries.git, root, runDir, target, candidateSha);
          try {
            ledger.beforeNext('verifier', 8_000, progress);
            const output = await runVerifier({ binary: tools.binaries.agy, gitBinary: tools.binaries.git, repository: root, worktree: target,
              env: tools.verifierEnv, runDir, task, candidateSha, conversationId: fresh ? undefined : conversationId,
              number: verifierCount, invoke: hooks.verifierInvoke });
            ledger.add('verifier', output.tokens);
            if (!fresh) conversationId = output.conversationId;
            return output;
          } finally { await removeWorktree(tools.binaries.git, root, runDir, target); }
        };
        verdict = await verifyOnce();
        if (verdict.verdict === 'PASS' && task.risk === 'CRITICAL') {
          state.to('VERIFYING', { sha: candidateSha, freshContext: true });
          verdict = await verifyOnce(true);
        }
      }
      if (verdict.verdict === 'FAIL') {
        if (verifyFix >= ledger.policy.maxVerifyFix) throw new Error('HUMAN_REVIEW_REQUIRED: VERIFICATION_ROUNDS');
        verifyFix++;
        feedback = JSON.stringify(verdict.findings);
        progress = verdict.findings.length > 0;
        continue;
      }
      state.to('VERIFIED', { sha: candidateSha, verifier: task.risk === 'LOW' ? 'not required by LOW policy' : 'independent' });
      state.to('GATING_FINAL');
      await runGates({ pnpm: tools.pnpm, worktree: builderWorktree, env: tools.gateEnv, storeDir: join(root, '.pnpm-store'), invoke: hooks.gateInvoke });
      if ((await changedPaths(tools.binaries.git, builderWorktree)).length) throw new Error('PROTOCOL_VIOLATION: POST_GATE_MUTATION');
      state.to('CI_PENDING', { sha: candidateSha });
      prUrl = await (hooks.publishCandidate ?? publishCandidate)({ gitBinary: tools.binaries.git, ghBinary: tools.binaries.gh, worktree: builderWorktree,
        root, runDir, task, candidateSha, branch, repository: tools.repository, previousPr: prUrl });
      ciResult = await (hooks.waitForCi ?? waitForCi)({ ghBinary: tools.binaries.gh, root, repository: tools.repository, candidateSha });
      if (ciResult.status === 'PASSED') {
        state.to('READY_FOR_APPROVAL', { sha: candidateSha, prUrl });
        return record();
      }
      if (ciFix >= ledger.policy.maxCiFix) throw new Error('HUMAN_REVIEW_REQUIRED: CI_ROUNDS');
      ciFix++;
      feedback = JSON.stringify(ciResult.checks);
      progress = ciResult.checks.some(check => check.conclusion && check.conclusion !== 'success');
    }
  } catch (error) {
    state.to(terminalCode(error), { reason: String(error?.message ?? error).slice(0, 500) });
    return { ...record(), reason: String(error?.message ?? error), unauthorized: error?.unauthorized ?? null };
  } finally {
    if (builderCreated) await removeWorktree(tools.binaries.git, root, runDir, builderWorktree);
  }
}

export function readTask(path) { return loadTaskSpec(JSON.parse(readFileSync(path, 'utf8'))); }
