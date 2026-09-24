import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { run } from './process.mjs';
import { git, snapshot, verifySnapshot } from './git.mjs';

const builderSchema = {
  type: 'object', additionalProperties: false, required: ['summary'],
  properties: { summary: { type: 'string', minLength: 1, maxLength: 2000 } },
};
const verifierSchema = {
  type: 'object', additionalProperties: false,
  required: ['candidateSha', 'verdict', 'rationale', 'findings'],
  properties: {
    candidateSha: { type: 'string', pattern: '^[a-f0-9]{40}$' },
    verdict: { enum: ['PASS', 'FAIL'] },
    rationale: { type: 'string', minLength: 1, maxLength: 2000 },
    findings: { type: 'array', maxItems: 20, items: {
      type: 'object', additionalProperties: false, required: ['path', 'message'],
      properties: { path: { type: 'string', maxLength: 240 }, message: { type: 'string', minLength: 1, maxLength: 1000 } },
    } },
  },
};
const validateBuilder = new Ajv().compile(builderSchema);
const validateVerifier = new Ajv().compile(verifierSchema);

export function codexTokens(jsonl) {
  const events = jsonl.split(/\r?\n/).filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const completed = events.filter(event => event.type === 'turn.completed').at(-1);
  const usage = completed?.usage;
  if (Number.isSafeInteger(usage?.total_tokens)) return usage.total_tokens;
  if (Number.isSafeInteger(usage?.input_tokens) && Number.isSafeInteger(usage?.output_tokens)) return usage.input_tokens + usage.output_tokens;
  throw new Error('MISSING_USAGE');
}

export async function runBuilder({ binary, prefix = [], worktree, env, runDir, task, feedback = '', round = 0, invoke = run }) {
  const schemaPath = join(runDir, 'builder-schema.json');
  const resultPath = join(runDir, `builder-${round}.json`);
  writeFileSync(schemaPath, JSON.stringify(builderSchema));
  const prompt = [
    'You are the Codex Builder for this approved RIFAD engineering task.',
    'Edit only the allowed paths. Do not create commits, branches, tags, pushes, pull requests, or GitHub actions. The orchestrator owns all Git/GitHub mutations.',
    'Do not run git add, git commit, git push, gh, or use real credentials/customer data.',
    `Task: ${task.taskId}. Risk: ${task.risk}. Base SHA: ${task.baseSha}.`,
    `Objective: ${task.objective}`,
    `Acceptance: ${JSON.stringify(task.acceptance)}`,
    `Allowed paths: ${JSON.stringify(task.allowedPaths)}`,
    feedback ? `Address these independent findings or CI failures: ${feedback}` : '',
    'Return a short JSON summary. Leave all changes unstaged.',
  ].filter(Boolean).join('\n');
  const args = ['--ask-for-approval', 'never', 'exec', '--json', '--output-schema', schemaPath, '--output-last-message', resultPath,
    '--sandbox', 'workspace-write', '--ignore-user-config', '-C', worktree, prompt];
  const result = await invoke(binary, [...prefix, ...args], { cwd: worktree, env, timeoutMs: 20 * 60_000 });
  if (result.code !== 0 || result.timedOut || result.overflow) throw new Error('BLOCKED: BUILDER_FAILED');
  let output;
  try { output = JSON.parse(readFileSync(resultPath, 'utf8')); } catch { throw new Error('BLOCKED: BUILDER_OUTPUT_INVALID'); }
  if (!validateBuilder(output)) throw new Error('BLOCKED: BUILDER_OUTPUT_INVALID');
  return { output, tokens: codexTokens(result.stdout) };
}

export async function runVerifier({ binary, gitBinary, repository, worktree, env, runDir, task, candidateSha, conversationId, number, invoke = run }) {
  const before = await snapshot(gitBinary, worktree);
  const repositoryBefore = await snapshot(gitBinary, repository);
  let result, parsed, thrown;
  try {
    const diff = await git(gitBinary, worktree, ['diff', '--binary', `${task.baseSha}..${candidateSha}`]);
    if (Buffer.byteLength(diff, 'utf8') > 80_000) throw new Error('HUMAN_REVIEW_REQUIRED: DIFF_TOO_LARGE');
    const prompt = [
      'You are Antigravity, an independent read-only verifier of a RIFAD candidate.',
      'Use only the supplied task, acceptance criteria, and complete diff. Do not call tools, execute commands, read other files, or modify any file.',
      'Return FAIL if the evidence is insufficient. Never implement fixes or control Git/GitHub.',
      `Task: ${task.taskId}. Risk: ${task.risk}. Base SHA: ${task.baseSha}. Exact candidate SHA: ${candidateSha}.`,
      `Objective: ${task.objective}`,
      `Acceptance: ${JSON.stringify(task.acceptance)}`,
      `Allowed paths: ${JSON.stringify(task.allowedPaths)}`,
      'Candidate diff follows:', diff,
    ].join('\n');
    const args = ['--disable-slash-commands', '--print', prompt, '--output-format', 'json', '--json-schema', JSON.stringify(verifierSchema), '--print-timeout', '10m'];
    if (conversationId) args.push('--conversation', conversationId);
    result = await invoke(binary, args, { cwd: worktree, env, timeoutMs: 11 * 60_000 });
    if (result.code !== 0 || result.timedOut || result.overflow) throw new Error('BLOCKED: VERIFIER_PROCESS_FAILED');
    try { parsed = JSON.parse(result.stdout); } catch { throw new Error('BLOCKED: VERIFIER_OUTPUT_INVALID'); }
    if (parsed.status !== 'SUCCESS' || !validateVerifier(parsed.structured_output) || parsed.structured_output.candidateSha !== candidateSha) throw new Error('BLOCKED: VERIFIER_OUTPUT_INVALID');
    if (!Number.isSafeInteger(parsed.usage?.total_tokens)) throw new Error('MISSING_USAGE');
  } catch (error) { thrown = error; }
  const after = await snapshot(gitBinary, worktree);
  const repositoryAfter = await snapshot(gitBinary, repository);
  const evidence = { candidateSha, before, after, repositoryBefore, repositoryAfter,
    result: parsed?.structured_output ?? null, status: parsed?.status ?? null, error: thrown?.message ?? null };
  writeFileSync(join(runDir, `verifier-${number}.json`), JSON.stringify(evidence, null, 2) + '\n');
  verifySnapshot(before, after, candidateSha);
  verifySnapshot(repositoryBefore, repositoryAfter, repositoryBefore.head);
  if (thrown) throw thrown;
  return { ...parsed.structured_output, conversationId: parsed.conversation_id, tokens: parsed.usage.total_tokens };
}
