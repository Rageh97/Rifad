import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { filesUnder } from './governance/check-governance.mjs';

const integrationSuffix = '.integration.spec.ts';

/**
 * TypeScript specs under apps/ and libs/: unit specs by default, `*.integration.spec.ts` (real
 * infrastructure) when `integration` is true. An empty result is a failure, never a silent pass.
 */
export function discoverUnitTests(root = process.cwd(), integration = false) {
  const specs = ['apps','libs'].map(directory => resolve(root, directory)).filter(existsSync)
    .flatMap(directory => filesUnder(directory)).filter(file => file.endsWith('.spec.ts') && file.endsWith(integrationSuffix) === integration)
    .map(file => relative(root, file).replaceAll('\\','/')).sort();
  if (!specs.length) throw new Error(integration ? 'No integration test files discovered' : 'No unit test files discovered');
  return specs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const integration = process.argv.includes('--integration');
    const specs = discoverUnitTests(process.cwd(), integration);
    // The root tsconfig only lists references; compiler options such as decorators live in the base config.
    const env = { ...process.env, TSX_TSCONFIG_PATH: resolve('tsconfig.base.json') };
    // Integration suites share one Docker engine; run files one at a time to bound host memory.
    const concurrency = integration ? ['--test-concurrency=1'] : [];
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...concurrency, ...specs], { stdio: 'inherit', env });
    process.exitCode = child.status ?? 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
