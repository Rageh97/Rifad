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
if (!batch || !/^B\d{3}[A-Za-z]?$/.test(batch)) {
  console.error('USAGE: pnpm codex:handoff -- --batch B00X --summary "what changed" [--timeout-minutes 60]');
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
  '--sandbox', 'workspace-write', '-C', root, '-'];
console.log(JSON.stringify({ event: 'codex.handoff.started', batch, runDir }));
const child = spawn('codex', codexArgs, { cwd: root, env, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.end(prompt);
let transcript = '';
child.stdout.on('data', chunk => { transcript += chunk; });
child.stderr.on('data', chunk => { transcript += chunk; });
const timer = setTimeout(() => child.kill(), timeoutMinutes * 60_000);
const code = await new Promise(done => child.on('close', done));
clearTimeout(timer);
writeFileSync(join(runDir, 'transcript.jsonl'), transcript);

let report;
try { report = JSON.parse(readFileSync(resultPath, 'utf8')); } catch { report = undefined; }
const newlyChanged = changedPaths().filter(path => !before.has(path));
const outOfScope = newlyChanged.filter(path => !allowed.some(pattern => pattern.test(path)));
const outcome = {
  event: 'codex.handoff.finished', batch, exitCode: code, runDir,
  status: outOfScope.length ? 'SCOPE_VIOLATION' : report?.status ?? 'NO_REPORT',
  outOfScope, newlyChanged, report,
};
writeFileSync(join(runDir, 'outcome.json'), JSON.stringify(outcome, null, 2));
console.log(JSON.stringify(outcome, null, 2));
process.exitCode = outcome.status === 'PASS' ? 0 : 1;
