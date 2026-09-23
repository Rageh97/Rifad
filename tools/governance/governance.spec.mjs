import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { extract, verify } from './extract-architecture.mjs';
import { checkGovernance, validateExceptions, validateTaskTable } from './check-governance.mjs';

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
});

test('batch scope/dependency/status violations fail', () => {
  const source = readFileSync('docs/work/batches/B001.md','utf8');
  validateTaskTable(source);
  assert.throws(()=>validateTaskTable(source.replace('| M0-001.a | M0-038.a |', '| M0-001.a | M0-999.a |')), /dependency/);
  assert.throws(()=>validateTaskTable(source.replace('M0-054.a','M0-999.a')), /scope|dependency/);
  assert.throws(()=>validateTaskTable(source.replace(/^Status:.*$/m,'Status: imaginary')), /status/);
});

test('no governance exceptions initially; incomplete, expired and architecture-changing exceptions fail', () => {
  assert.deepEqual(JSON.parse(readFileSync('docs/architecture/exceptions.json','utf8')), []);
  assert.throws(()=>validateExceptions([{}],process.cwd()), /Incomplete/);
  const record = { id:'test',rule:'test',scope:'test',rationale:'test',owner:'test',approvalEvidence:'AGENTS.md',tests:'tools/governance/governance.spec.mjs',reviewAction:'docs/work/decisions.md',architectureChange:false,expiresAt:'2000-01-01' };
  assert.throws(()=>validateExceptions([record],process.cwd()), /Expired/);
  assert.throws(()=>validateExceptions([{...record,architectureChange:true}],process.cwd()), /Architectural/);
});
