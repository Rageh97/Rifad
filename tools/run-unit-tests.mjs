import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { filesUnder } from './governance/check-governance.mjs';

/** Every TypeScript spec under apps/ and libs/; an empty result is a failure, never a silent pass. */
export function discoverUnitTests(root = process.cwd()) {
  const specs = ['apps','libs'].map(directory => resolve(root, directory)).filter(existsSync)
    .flatMap(directory => filesUnder(directory)).filter(file => file.endsWith('.spec.ts'))
    .map(file => relative(root, file).replaceAll('\\','/')).sort();
  if (!specs.length) throw new Error('No unit test files discovered');
  return specs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const specs = discoverUnitTests();
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...specs], { stdio: 'inherit' });
    process.exitCode = child.status ?? 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
