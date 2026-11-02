#!/usr/bin/env node
// Hands a finished implementation to Codex for testing (docs/engineering/codex-handoff.md).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const batch = option('--batch');
const summary = option('--summary') ?? '';
const timeoutMinutes = Number(option('--timeout-minutes') ?? 60);
// Defaults agreed with the user on 2026-11-02: gpt-6-sol (the 6.1 models are unavailable to Codex on the
// account's ChatGPT sign-in) at medium effort. Both can be overridden per run.
const model = option('--model') ?? 'gpt-6-sol';
const effort = option('--effort') ?? 'medium';
if ((model && !/^[A-Za-z0-9._-]+$/.test(model)) || (effort && !/^[a-z]+$/.test(effort))) { console.error('Invalid --model or --effort'); process.exit(2); }
if (!batch || !/^B\d{3}[A-Za-z]?$/.test(batch)) {
  console.error('USAGE: pnpm codex:handoff -- --batch B00X --summary "what changed" [--model NAME] [--effort LEVEL] [--timeout-minutes 60]');
  process.exit(2);
}

/** Paths Codex may change: test code only. Everything else is a scope violation. */
const allowed = [/\.spec\.ts$/, /\.spec\.mjs$/, /^libs\/shared\/testing\//, /^libs\/shared\/test-containers\//];
const git = (...command) => spawnSync('git', command, { cwd: root, encoding: 'utf8' }).stdout;
const changedPaths = () => git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean)
  .map(line => line.slice(3).replace(/^.* -> /, '').replaceAll('\\', '/'));

const runDir = join(root, '.agent-runs', 'codex-handoff', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(runDir, { recursive: true });
const before = new Set(changedPaths());
const schema = {
  type: 'object', additionalProperties: false,
  required: ['status', 'checks', 'changedFiles', 'codeDefects', 'testDefectsFixed', 'notes'],
  properties: {
    status: { enum: ['PASS', 'FAIL', 'BLOCKED'] },
    checks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['command', 'result', 'summary'],
      properties: { command: { type: 'string' }, result: { enum: ['pass', 'fail', 'not_run', 'flaky'] }, summary: { type: 'string' } } } },
    changedFiles: { type: 'array', items: { type: 'string' } },
    codeDefects: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['file', 'line', 'description'],
      properties: { file: { type: 'string' }, line: { type: 'integer' }, description: { type: 'string' } } } },
    testDefectsFixed: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
};
const schemaPath = join(runDir, 'schema.json');
const resultPath = join(runDir, 'result.json');
writeFileSync(schemaPath, JSON.stringify(schema));

const standing = readFileSync(join(root, 'docs/engineering/codex-handoff.md'), 'utf8')
  .split('## Standing instructions for Codex')[1]?.split('## Operation')[0]?.trim();
if (!standing) { console.error('Standing instructions missing from docs/engineering/codex-handoff.md'); process.exit(2); }
const prompt = [
  standing,
  `Batch: ${batch} (record: docs/work/batches/${batch}.md).`,
  `Implementation summary from the implementing agent: ${summary || '(none given)'}`,
  `Branch: ${git('rev-parse', '--abbrev-ref', 'HEAD').trim()} at ${git('rev-parse', 'HEAD').trim()}.`,
  `Changes since main:\n${git('diff', '--stat', 'origin/main...HEAD').trim() || '(none)'}`,
].join('\n\n');
writeFileSync(join(runDir, 'prompt.txt'), prompt);

const pinnedBin = join(root, '.tools', 'package', 'bin');
const env = { ...process.env, PATH: pinnedBin + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH ?? '') };
const codexArgs = ['--approve-for-me', 'exec', '--json', '--output-schema', schemaPath, '--output-last-message', resultPath,
  '--sandbox', 'workspace-write', ...(model ? ['-m', model] : []), ...(effort ? ['-c', 'model_reasoning_effort=' + effort] : []), '-C', root, '-'];
console.log(JSON.stringify({ event: 'codex.handoff.started', batch, runDir, model, effort }));
const child = spawn('codex', codexArgs, { cwd: root, env, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.end(prompt);
let transcript = '';
child.stdout.on('data', chunk => { transcript += chunk; });
child.stderr.on('data', chunk => { transcript += chunk; });
// On Windows Codex runs under a shell; killing only the shell would orphan Codex, so kill the whole tree.
const killTree = () => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGKILL');
};
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMinutes * 60_000);
// 'exit' plus a short grace period: an orphaned grandchild holding stdio open must not block the report.
const code = await new Promise(done => {
  child.on('exit', exitCode => setTimeout(() => done(exitCode), 5_000));
  child.on('error', () => done(-1));
});
clearTimeout(timer);
writeFileSync(join(runDir, 'transcript.jsonl'), transcript);

let report;
try { report = JSON.parse(readFileSync(resultPath, 'utf8')); } catch { report = undefined; }
const newlyChanged = changedPaths().filter(path => !before.has(path));
const outOfScope = newlyChanged.filter(path => !allowed.some(pattern => pattern.test(path)));
const outcome = {
  event: 'codex.handoff.finished', batch, exitCode: code, runDir,
  status: outOfScope.length ? 'SCOPE_VIOLATION' : timedOut ? 'TIMEOUT' : report?.status ?? 'NO_REPORT',
  outOfScope, newlyChanged, report,
};
writeFileSync(join(runDir, 'outcome.json'), JSON.stringify(outcome, null, 2));
console.log(JSON.stringify(outcome, null, 2));
process.exitCode = outcome.status === 'PASS' ? 0 : 1;
