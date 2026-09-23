import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { projectInventory } from '../../../../tools/architecture-policy.mjs';

const root=process.cwd();
const require=createRequire(import.meta.url);
const eslintBin=resolve(require.resolve('eslint/package.json'),'../bin/eslint.js');
const nxBin=resolve(require.resolve('nx/package.json'),'../dist/bin/nx.js');
test('every real project is classified and composition roots do not import each other', () => {
  const projects=projectInventory();
  assert.equal(projects.length,4);
  for(const app of ['api','worker','edge']) {
    const source=readFileSync('apps/'+app+'/src/main.ts','utf8');
    assert.ok(!/from ['"].*(?:apps\/|postgres|bullmq|redis|sqlite)/i.test(source));
  }
});

test('actual ESLint/Nx rejects intentionally violated architecture fixtures', {timeout:180000}, () => {
  mkdirSync('.test-artifacts',{recursive:true});
  const directory=mkdtempSync(resolve('.test-artifacts','architecture-'));
  assert.ok(directory.startsWith(resolve('.test-artifacts')+sep));
  const write=(file,content)=>{const path=join(directory,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof content==='string'?content:JSON.stringify(content));};
  try {
    // The fixture is below the workspace root, so Node resolves the pinned tools
    // from the parent node_modules without a Windows junction or special privilege.
    write('package.json',{name:'architecture-fixtures',private:true,devDependencies:{nx:'23.2.1','@nestjs/common':'11.2.5'}});
    write('nx.json',{useDaemonProcess:false});
    const projects=[
      ['ordering',['scope:ordering','layer:domain','runtime:shared']],
      ['payments',['scope:payments','layer:infrastructure','runtime:shared']],
      ['contract',['scope:payments','layer:contract','runtime:shared']],
      ['edge',['scope:shared','layer:composition','runtime:edge']],
      ['cloud',['scope:shared','layer:infrastructure','runtime:cloud']],
      ['inventory',['scope:inventory','layer:domain','runtime:shared']],
      ['recipes',['scope:recipes','layer:domain','runtime:shared']],
    ];
    const paths={};
    for(const [name,tags] of projects) {
      write('libs/'+name+'/project.json',{name,sourceRoot:'libs/'+name+'/src',projectType:'library',tags});
      write('libs/'+name+'/src/index.ts','export const value = 1;\n');
      write('libs/'+name+'/src/private.ts','export const hidden = 2;\n');
      paths['@rifad/'+name]=['libs/'+name+'/src/index.ts'];
      paths['@rifad/'+name+'/*']=['libs/'+name+'/src/*'];
    }
    write('tsconfig.base.json',{compilerOptions:{baseUrl:'.',paths}});
    const cases=[
      ['public contract allowed','ordering',"import { value } from '@rifad/contract'; export const result = value;",true],
      ['Domain infrastructure forbidden','ordering',"import { Module } from '@nestjs/common'; export const result = Module;",false],
      ['cross-context private forbidden','ordering',"import { hidden } from '@rifad/payments/private'; export const result = hidden;",false],
      ['Edge BullMQ forbidden','edge',"import { Queue } from 'bullmq'; export const result = Queue;",false],
      ['Edge Cloud infrastructure forbidden','edge',"import { value } from '@rifad/cloud'; export const result = value;",false],
      ['Inventory Recipes forbidden','inventory',"import { value } from '@rifad/recipes'; export const result = value;",false],
    ];
    for(const [label,project,source,allowed] of cases) {
      for(const [name] of projects) write('libs/'+name+'/src/index.ts','export const value = 1;\n');
      write('libs/'+project+'/src/index.ts',source+'\n');
      rmSync(join(directory,'.nx'),{recursive:true,force:true});
      const graph=spawnSync(process.execPath,[nxBin,'show','projects'],{
        cwd:directory,env:{...process.env,NX_DAEMON:'false',NX_ISOLATE_PLUGINS:'false'},encoding:'utf8',timeout:45000,maxBuffer:2*1024*1024,
      });
      assert.equal(graph.status,0,label+': project graph failed '+graph.stdout+graph.stderr);
      const run=spawnSync(process.execPath,[eslintBin,'libs/'+project+'/src/index.ts','--config',resolve(root,'eslint.config.mjs'),'--format','json'],{
        cwd:directory,env:{...process.env,NX_DAEMON:'false',NX_ISOLATE_PLUGINS:'false'},encoding:'utf8',timeout:45000,maxBuffer:2*1024*1024,
      });
      assert.equal(run.error,undefined,label+': '+run.error);
      const output=run.stdout;
      let results;
      try { results=JSON.parse(output.slice(output.indexOf('['))); }
      catch { assert.fail(label+': invalid linter output '+output+run.stderr); }
      const violations=results.flatMap(result=>result.messages).filter(message=>['@nx/enforce-module-boundaries','no-restricted-imports'].includes(message.ruleId));
      if(allowed) assert.equal(run.status,0,label+': '+output+run.stderr);
      else { assert.equal(run.status,1,label+': '+output+run.stderr);assert.ok(violations.length>0,label); }
      console.log(label+': '+(allowed?'accepted':'rejected (expected)'));
    }
  } finally {
    if(directory.startsWith(resolve('.test-artifacts')+sep)) rmSync(directory,{recursive:true,force:true});
  }
});
