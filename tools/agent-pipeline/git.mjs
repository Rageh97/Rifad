import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { resolve, relative, sep, join } from 'node:path';
import { checked } from './process.mjs';
import { pathName, scopeResult } from './policy.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const nulList = value => value.split('\0').filter(Boolean);

export function assertRunPath(runRoot, target) {
  const root = resolve(runRoot);
  const path = resolve(target);
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || rel.startsWith(sep)) throw new Error('UNSAFE_WORKTREE_PATH');
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) throw new Error('UNSAFE_WORKTREE_PATH');
  if (existsSync(path)) {
    const actual = realpathSync(path);
    const actualRel = relative(realpathSync(root), actual);
    if (!actualRel || actualRel === '..' || actualRel.startsWith('..' + sep) || actualRel.startsWith(sep)) throw new Error('UNSAFE_WORKTREE_PATH');
  }
  return path;
}

export async function git(binary, cwd, args, timeoutMs = 60_000) {
  return await checked(binary, args, { cwd, env: process.env, timeoutMs });
}

export async function createDetached(binary, repository, runRoot, target, sha) {
  assertRunPath(runRoot, target);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('INVALID_SHA');
  await git(binary, repository, ['worktree', 'add', '--detach', target, sha]);
  const head = (await git(binary, target, ['rev-parse', 'HEAD'])).trim();
  if (head !== sha) throw new Error('WORKTREE_SHA_MISMATCH');
  if ((await git(binary, target, ['status', '--porcelain=v2', '-z'])) !== '') throw new Error('WORKTREE_NOT_CLEAN');
  return target;
}

export async function removeWorktree(binary, repository, runRoot, target) {
  assertRunPath(runRoot, target);
  if (existsSync(target)) await git(binary, repository, ['worktree', 'remove', '--force', target]);
}

export async function changedPaths(binary, worktree) {
  const tracked = nulList(await git(binary, worktree, ['diff', '--name-only', '--no-renames', '-z', 'HEAD']));
  const untracked = nulList(await git(binary, worktree, ['ls-files', '--others', '--exclude-standard', '-z']));
  return [...new Set([...tracked, ...untracked].map(pathName))].sort();
}

export async function enforceScope(binary, worktree, allowedPaths) {
  const paths = await changedPaths(binary, worktree);
  const result = scopeResult(paths, allowedPaths);
  if (!result.ok) throw Object.assign(new Error('SCOPE_VIOLATION'), { paths, unauthorized: result.unauthorized });
  if (!paths.length) throw new Error('EMPTY_CANDIDATE');
  for (const path of paths) {
    const full = join(worktree, path);
    if (existsSync(full) && lstatSync(full).isSymbolicLink()) throw new Error('SCOPE_VIOLATION: SYMLINK');
  }
  return paths;
}

export async function commitCandidate(binary, worktree, paths, taskId) {
  if (!paths.length) throw new Error('EMPTY_CANDIDATE');
  for (const path of paths) pathName(path);
  const preStaged = nulList(await git(binary, worktree, ['diff', '--cached', '--name-only', '-z']));
  if (preStaged.length) throw new Error('PRESTAGED_CHANGES');
  await git(binary, worktree, ['add', '--', ...paths]);
  const staged = nulList(await git(binary, worktree, ['diff', '--cached', '--name-only', '--no-renames', '-z'])).sort();
  if (JSON.stringify(staged) !== JSON.stringify([...paths].sort())) throw new Error('STAGED_SCOPE_MISMATCH');
  const modes = await git(binary, worktree, ['ls-files', '-s', '-z']);
  for (const entry of nulList(modes)) {
    const match = /^(\d+) [a-f0-9]+ \d+\t(.+)$/s.exec(entry);
    if (match && paths.includes(match[2]) && ['120000', '160000'].includes(match[1])) throw new Error('SCOPE_VIOLATION: SPECIAL_FILE');
  }
  await git(binary, worktree, ['commit', '-m', `chore(${taskId.toLowerCase()}): approved agent candidate`], 120_000);
  return (await git(binary, worktree, ['rev-parse', 'HEAD'])).trim();
}

export async function snapshot(binary, worktree) {
  const [head, tree, index, diff, status, tracked, refs] = await Promise.all([
    git(binary, worktree, ['rev-parse', 'HEAD']),
    git(binary, worktree, ['rev-parse', 'HEAD^{tree}']),
    git(binary, worktree, ['ls-files', '-s', '-z']),
    git(binary, worktree, ['diff', '--binary', 'HEAD']),
    git(binary, worktree, ['status', '--porcelain=v2', '-z', '--untracked-files=all']),
    git(binary, worktree, ['ls-files', '-z']),
    git(binary, worktree, ['for-each-ref', '--format=%(refname) %(objectname)']),
  ]);
  const fileHashes = [];
  for (const path of nulList(tracked)) {
    const full = join(worktree, path);
    if (!existsSync(full)) { fileHashes.push([path, 'MISSING']); continue; }
    const stat = lstatSync(full);
    fileHashes.push([path, hash(stat.isSymbolicLink() ? readlinkSync(full) : readFileSync(full))]);
  }
  return {
    head: head.trim(), tree: tree.trim(), indexHash: hash(index), diffHash: hash(diff),
    statusHash: hash(status), trackedHash: hash(JSON.stringify(fileHashes)), refsHash: hash(refs),
    status: status ? nulList(status) : [],
  };
}

export function verifySnapshot(before, after, expectedSha) {
  const fields = ['head', 'tree', 'indexHash', 'diffHash', 'statusHash', 'trackedHash', 'refsHash'];
  const changed = fields.filter(field => before[field] !== after[field]);
  if (before.head !== expectedSha || after.head !== expectedSha || before.status.length || changed.length) {
    throw Object.assign(new Error('PROTOCOL_VIOLATION'), { changed, before, after });
  }
  return true;
}
