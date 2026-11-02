import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { extract, verify } from './extract-architecture.mjs';
import { checkGovernance, validateBatches, validateExceptions, validateInstructionScopes } from './check-governance.mjs';
import { discoverUnitTests } from '../run-unit-tests.mjs';

test('source rendition is deterministic and contains all sections, tables, paragraphs and ADR entries', () => {
  const result = verify();
  assert.deepEqual(result, extract(readFileSync('RIFAD_v1.4_FINAL.docx')));
  const manifest = JSON.parse(result.manifest);
  assert.equal(manifest.paragraphs, 2276);
  assert.equal(manifest.tables, 33);
  assert.equal(manifest.rows, 489);
  assert.equal(manifest.sections.length, 37);
  for(let n=1;n<=43;n++) assert.ok(result.markdown.includes('ADR-' + String(n).padStart(3,'0')));
  assert.ok(result.markdown.includes('| restaurant.check_round.submitted.v1 | EDGE / PER_CHECK |'));
  assert.ok(result.markdown.includes('NONAUTHORITATIVE'));
});

test('unsupported merged source table fails instead of losing relationships', () => {
  const zip = unzipSync(readFileSync('RIFAD_v1.4_FINAL.docx'));
  zip['word/document.xml'] = strToU8(strFromU8(zip['word/document.xml']).replace('<w:tc>', '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>'));
  assert.throws(()=>extract(zipSync(zip)), /Unsupported source structure/);
});

test('governance links, required files and root/Edge scoped instruction inventory pass', () => {
  const result = checkGovernance();
  assert.deepEqual(result.scopes, ['AGENTS.md','apps/edge/AGENTS.md']);
  assert.deepEqual(result.warnings, []);
  const manifest = JSON.parse(readFileSync('docs/work/governance.json','utf8'));
  assert.throws(()=>validateInstructionScopes([...result.scopes, 'libs/unregistered/AGENTS.md'], manifest), /scope drift/);
  assert.throws(()=>validateInstructionScopes(['AGENTS.md'], manifest), /scope drift/);
});

test('batch scope/dependency/status violations fail', () => {
  const manifest = JSON.parse(readFileSync('docs/work/governance.json','utf8'));
  const batches = Object.fromEntries(manifest.batches.map(({ id }) => [id, readFileSync('docs/work/batches/' + id + '.md','utf8')]));
  validateBatches(batches, manifest);
  const b001 = batches.B001;
  const mutate = (id, source) => () => validateBatches({ ...batches, [id]: source }, manifest);
  assert.throws(mutate('B001', b001.replace('| M0-001.a | M0-038.a |', '| M0-001.a | M0-999.a |')), /dependency/);
  assert.throws(mutate('B001', b001.replace('M0-054.a','M0-999.a')), /scope|dependency/);
  assert.throws(mutate('B001', b001.replace(/^Status:.*$/m,'Status: imaginary')), /status/);
  assert.throws(mutate('B001', b001.replace(/^Approval:.*$/m,'Approval: implied')), /approval/);
  assert.throws(mutate('B001', b001.replace('| Workspace and compatible pinned toolchain | COMPLETE |', '| Workspace and compatible pinned toolchain | PENDING |')), /incomplete task/);
  assert.throws(mutate('B001', b001.replace('| Workspace and compatible pinned toolchain | COMPLETE |', '| Workspace and compatible pinned toolchain | DONE-ISH |')), /task status/);
  assert.throws(mutate('B002E', batches.B002E.replace('| M0-036.b |', '| M0-036.a |')), /Duplicate|scope/);
  assert.throws(()=>validateBatches({ ...batches, B999: b001 }, manifest), /manifest differ/);
  assert.throws(()=>validateBatches(batches, { batches: [...manifest.batches].reverse() }), /dependency/);
  assert.throws(()=>validateBatches(batches, { batches: [] }), /manifest/);
});

test('unit test discovery finds workspace specs and fails on an empty workspace', () => {
  assert.ok(discoverUnitTests().includes('libs/shared/runtime-config/src/config.spec.ts'));
  assert.ok(!discoverUnitTests().some(file => file.endsWith('.integration.spec.ts')));
  assert.deepEqual(discoverUnitTests(process.cwd(), true), ['libs/shared/database/src/database.integration.spec.ts', 'libs/shared/outbox-relay/src/relay.integration.spec.ts']);
  const empty = mkdtempSync(join(tmpdir(), 'rifad-empty-'));
  try { assert.throws(()=>discoverUnitTests(empty), /No unit test files/); assert.throws(()=>discoverUnitTests(empty, true), /No integration test files/); }
  finally { rmSync(empty, { recursive: true, force: true }); }
});

test('no governance exceptions initially; incomplete, expired and architecture-changing exceptions fail', () => {
  assert.deepEqual(JSON.parse(readFileSync('docs/architecture/exceptions.json','utf8')), []);
  assert.throws(()=>validateExceptions([{}],process.cwd()), /Incomplete/);
  const record = { id:'test',rule:'test',scope:'test',rationale:'test',owner:'test',approvalEvidence:'AGENTS.md',tests:'tools/governance/governance.spec.mjs',reviewAction:'docs/work/decisions.md',architectureChange:false,expiresAt:'2000-01-01' };
  assert.throws(()=>validateExceptions([record],process.cwd()), /Expired/);
  assert.throws(()=>validateExceptions([{...record,architectureChange:true}],process.cwd()), /Architectural/);
});
