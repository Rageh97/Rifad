#!/usr/bin/env node
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { execute } from './pipeline.mjs';
import { preflight } from './preflight.mjs';
import { selectPinnedRuntime } from './process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = selectPinnedRuntime(root);
if (resolve(process.execPath).toLowerCase() !== resolve(runtime.node).toLowerCase()) {
  const child = spawnSync(runtime.node, process.argv.slice(1), { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
  process.exit(child.status ?? 1);
}

const [command, specPath] = process.argv.slice(2);
try {
  if (command === 'preflight') {
    const temporary = resolve(root, '.agent-runs', 'preflight-tmp');
    mkdirSync(temporary, { recursive: true });
    const result = await preflight(root, temporary);
    process.stdout.write(JSON.stringify({
      status: 'READY', versions: result.versions, repository: result.repository,
      windows: result.windows, pinnedNode: runtime.node,
    }, null, 2) + '\n');
  } else if (command === 'run' && specPath) {
    const spec = JSON.parse(readFileSync(resolve(specPath), 'utf8'));
    const result = await execute(root, spec);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.status !== 'READY_FOR_APPROVAL') process.exitCode = 1;
  } else {
    throw new Error('USAGE: node tools/agent-pipeline/cli.mjs preflight | run <task-spec.json>');
  }
} catch (error) {
  process.stderr.write(String(error?.message ?? error) + '\n');
  process.exitCode = 1;
}
