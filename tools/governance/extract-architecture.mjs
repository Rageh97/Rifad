import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

export const sourceName = 'RIFAD_v1.4_FINAL.docx';
const outputDir = 'docs/architecture/generated';
const fence = String.fromCharCode(96).repeat(3);
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, parseTagValue: false, trimValues: false });
function find(nodes, key) {
  for (const node of nodes) {
    if (node[key]) return node[key];
    for (const [name, value] of Object.entries(node)) {
      if (name !== ':@' && Array.isArray(value)) {
        const result = find(value, key);
        if (result) return result;
      }
    }
  }
}
function text(nodes) {
  return nodes.map(node => {
    if (node['w:t']) return node['w:t'].map(n => n['#text'] ?? '').join('');
    if (node['w:tab']) return '\t';
    if (node['w:br']) return '\n';
    return Object.entries(node).filter(([key,value]) => key !== ':@' && Array.isArray(value)).map(([,value]) => text(value)).join('');
  }).join('');
}
function style(nodes) {
  for (const node of find(nodes, 'w:pPr') ?? []) {
    if (node['w:pStyle']) return node[':@']?.['@_w:val'];
  }
}
function escape(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '\\|').replaceAll('\n', '<br>');
}
export function extract(bytes) {
  const zip = unzipSync(bytes);
  if (!zip['word/document.xml']) throw new Error('Missing document body');
  if (['word/footnotes.xml', 'word/endnotes.xml', 'word/comments.xml'].some(name => zip[name])) throw new Error('Unsupported annotated source');
  const xml = strFromU8(zip['word/document.xml']);
  // Fail explicitly instead of building a general document-processing subsystem.
  if (/<w:(?:gridSpan|vMerge|drawing|pict|ins|del|altChunk|sdt|object|sym|footnoteReference|endnoteReference)\b/.test(xml)) throw new Error('Unsupported source structure');
  const body = find(parser.parse(xml), 'w:body');
  if (!body) throw new Error('Missing body');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const stats = { paragraphs: 0, tables: 0, rows: 0, cells: 0, sections: [] };
  const lines = ['# RIFAD v1.4 searchable rendition', '', '> NONAUTHORITATIVE — generated; do not edit. The DOCX source controls meaning.', '', 'Source: [RIFAD_v1.4_FINAL.docx](../../../RIFAD_v1.4_FINAL.docx)', '', 'SHA-256: ' + sha256, '', 'Body text and rectangular table cell relationships are preserved. Visual layout, headers and footers are not reproduced.', ''];
  for (const block of body) {
    if (block['w:p']) {
      stats.paragraphs++;
      const value = text(block['w:p']);
      const kind = style(block['w:p']);
      if (kind === 'Heading1' && /^(\d+)\. /.test(value)) {
        const number = Number(value.match(/^(\d+)\./)[1]);
        stats.sections.push(number);
        lines.push('<a id="section-' + number + '"></a>', '');
      }
      if (kind === 'CodeBlock') lines.push(fence+'text', value, fence, '');
      else if (value) lines.push((kind === 'Heading1' ? '## ' : kind === 'Heading2' ? '### ' : kind === 'ListBullet' ? '- ' : '') + escape(value), '');
    } else if (block['w:tbl']) {
      stats.tables++;
      const rows = block['w:tbl'].filter(node => node['w:tr']).map(node => {
        stats.rows++;
        return node['w:tr'].filter(cell => cell['w:tc']).map(cell => {
          stats.cells++;
          const paragraphs = cell['w:tc'].filter(p => p['w:p']);
          if (cell['w:tc'].some(p => p['w:tbl'])) throw new Error('Nested table unsupported');
          stats.paragraphs += paragraphs.length;
          return paragraphs.map(p => escape(text(p['w:p']))).join('<br>');
        });
      });
      if (!rows.length || !rows[0].length || rows.some(row => row.length !== rows[0].length)) throw new Error('Nonrectangular table unsupported');
      lines.push('| ' + rows[0].join(' | ') + ' |', '| ' + rows[0].map(() => '---').join(' | ') + ' |');
      for (const row of rows.slice(1)) lines.push('| ' + row.join(' | ') + ' |');
      lines.push('');
    } else if (!block['w:sectPr']) throw new Error('Unsupported top-level content');
  }
  if (stats.sections.length !== 37 || stats.sections.some((n,i) => n !== i + 1)) throw new Error('Source section inventory differs from v1.4');
  return {
    markdown: lines.map(line => line.trimEnd()).join('\n').trimEnd() + '\n',
    manifest: JSON.stringify({ source: sourceName, sha256, extractorVersion: 2, nonauthoritative: true, ...stats }, null, 2) + '\n',
  };
}
export function verify(root = process.cwd(), check = true) {
  const result = extract(readFileSync(resolve(root, sourceName)));
  if (!check) mkdirSync(resolve(root, outputDir), { recursive: true });
  for (const [name, content] of [['rifad-v1.4.md', result.markdown], ['manifest.json', result.manifest]]) {
    const path = resolve(root, outputDir, name);
    if (check) {
      if (readFileSync(path, 'utf8') !== content) throw new Error('Source/rendition drift: ' + name);
    } else writeFileSync(path, content);
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { verify(process.cwd(), process.argv.includes('--check')); console.log('Architecture source/rendition verified'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
