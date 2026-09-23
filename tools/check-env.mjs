import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const pkg = JSON.parse(readFileSync('package.json','utf8'));
assert.equal(process.versions.node, readFileSync('.node-version','utf8').trim(), 'Use the pinned Node runtime');
assert.equal(pkg.packageManager, 'pnpm@11.19.0');
const example = readFileSync('infra/local/.env.example','utf8');
for (const line of example.split('\n').filter(line=>line && !line.startsWith('#'))) {
  assert.match(line,/^RIFAD_(ENV=local|HOST=127\.0\.0\.1)$/);
}
const ignore = readFileSync('.gitignore','utf8').split(/\r?\n/);
for(const value of ['.env','.env.*','!.env.example','.tools/','.pnpm-store/']) assert.ok(ignore.includes(value));
console.log('Pinned runtime and nonsecret local environment verified');
