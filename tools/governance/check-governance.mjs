import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ignored = new Set(['.git', 'node_modules', 'dist', '.nx', '.tools', '.test-artifacts']);
export function filesUnder(root) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  visit(root);
  return files;
}
export function validateExceptions(records, root, now = new Date()) {
  if (!Array.isArray(records)) throw new Error('Exceptions must be an array');
  const ids = new Set();
  for (const item of records) {
    for (const key of ['id','rule','scope','rationale','owner','approvalEvidence','tests','reviewAction']) {
      if (!item[key] || typeof item[key] !== 'string') throw new Error('Incomplete exception: ' + key);
    }
    if (ids.has(item.id)) throw new Error('Duplicate exception');
    ids.add(item.id);
    if (item.architectureChange !== false) throw new Error('Architectural changes cannot be governance exceptions');
    if (!item.expiresAt) {
      if (!item.noExpiryApproval) throw new Error('Exception needs expiry or explicit no-expiry approval');
    } else if (!Number.isFinite(Date.parse(item.expiresAt)) || new Date(item.expiresAt) <= now) throw new Error('Expired/invalid exception');
    for (const key of ['approvalEvidence','tests','reviewAction']) {
      const target = resolve(root, item[key].split('#')[0]);
      if (relative(root, target).startsWith('..') || !existsSync(target)) throw new Error('Exception evidence missing/outside repository');
    }
  }
}
const taskStates = new Set(['PENDING','IMPLEMENTING','COMPLETE','IMPLEMENTED—VERIFICATION PENDING','BLOCKED']);
/** Validates batch records (name -> markdown) against the approved scopes in docs/work/governance.json, in manifest order. */
export function validateBatches(batches, manifest) {
  if (!Array.isArray(manifest?.batches) || !manifest.batches.length) throw new Error('Missing batch manifest');
  const listed = manifest.batches.map(batch => batch.id);
  if (new Set(listed).size !== listed.length || [...listed].sort().join(',') !== Object.keys(batches).sort().join(',')) throw new Error('Batch records and governance manifest differ');
  const seen = new Set();
  for (const { id, tasks } of manifest.batches) {
    const markdown = batches[id];
    const rows = [...markdown.matchAll(/^\| (M0-\d{3}\.[a-z]) \| ([^|]+) \| [^|]+ \| ([^|]+) \|$/gm)];
    if (!rows.length) throw new Error('Missing batch tasks: ' + id);
    const own = new Set();
    for (const [, task, dependencies, state] of rows) {
      if (seen.has(task) || own.has(task)) throw new Error('Duplicate task ID: ' + task);
      for (const dependency of dependencies.match(/M0-\d{3}\.[a-z]/g) ?? []) {
        if (!seen.has(dependency) && !own.has(dependency)) throw new Error('Unresolved or unordered dependency: ' + dependency);
      }
      if (!taskStates.has(state.trim())) throw new Error('Invalid task status: ' + task);
      own.add(task);
    }
    if (!Array.isArray(tasks) || own.size !== tasks.length || tasks.some(task => !own.has(task))) throw new Error('Approved batch scope drift: ' + id);
    const status = markdown.match(/^Status: (IMPLEMENTING|COMPLETE|IMPLEMENTED—VERIFICATION PENDING|BLOCKED)$/m)?.[1];
    if (!status) throw new Error('Invalid batch status: ' + id);
    if (status === 'COMPLETE' && rows.some(row => row[3].trim() !== 'COMPLETE')) throw new Error('Complete batch has incomplete task: ' + id);
    if (!/^Approval: explicit user /m.test(markdown)) throw new Error('Missing approval reference: ' + id);
    for (const task of own) seen.add(task);
  }
}
export function validateInstructionScopes(scopes, manifest) {
  if (!Array.isArray(manifest?.instructionScopes) || [...scopes].sort().join(',') !== [...manifest.instructionScopes].sort().join(',')) throw new Error('Instruction scope drift');
}
export function checkGovernance(root = process.cwd()) {
  const files = filesUnder(root);
  const warnings = [];
  const fence = String.fromCharCode(96).repeat(3);
  for (const file of files) {
    if (file.endsWith('AGENTS.override.md')) throw new Error('Committed override requires explicit governance review');
    if (file.endsWith('AGENTS.md') && statSync(file).size > (file === resolve(root,'AGENTS.md') ? 6144 : 3072)) warnings.push('Instruction size: ' + relative(root,file));
    if (!file.endsWith('.md')) continue;
    const source = readFileSync(file,'utf8').replace(new RegExp(fence+'[\\s\\S]*?'+fence,'g'), '');
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const link = match[1];
      if (/^(?:https?:|mailto:|#)/.test(link)) continue;
      const target = resolve(dirname(file), decodeURIComponent(link.split('#')[0]));
      if (relative(root,target).startsWith('..' + sep) || !existsSync(target)) throw new Error('Broken/local-outside link: ' + relative(root,file) + ' -> ' + link);
    }
  }
  for (const name of ['AGENTS.md','apps/edge/AGENTS.md','docs/work/current.md','docs/work/governance.json','docs/engineering/quality.md','docs/engineering/security.md','docs/engineering/performance.md','docs/engineering/verification.md']) {
    if (!existsSync(resolve(root,name))) throw new Error('Required guidance missing: ' + name);
  }
  const manifest = JSON.parse(readFileSync(resolve(root,'docs/work/governance.json'),'utf8'));
  const scopes = files.filter(path => path.endsWith('AGENTS.md')).map(path => relative(root,path).split(sep).join('/')).sort();
  validateInstructionScopes(scopes, manifest);
  const batchDirectory = resolve(root,'docs/work/batches');
  const batches = Object.fromEntries(readdirSync(batchDirectory).filter(name => name.endsWith('.md')).map(name => [name.slice(0,-3), readFileSync(resolve(batchDirectory,name),'utf8')]));
  validateBatches(batches, manifest);
  validateExceptions(JSON.parse(readFileSync(resolve(root,'docs/architecture/exceptions.json'),'utf8')),root);
  return { files: files.length, scopes, warnings };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = checkGovernance();
    for (const warning of result.warnings) console.warn(warning);
    console.log('Governance verified; scopes: ' + result.scopes.join(', '));
  } catch(error) { console.error(error.message); process.exitCode = 1; }
}
