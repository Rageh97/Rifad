import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { filesUnder } from './governance/check-governance.mjs';

export function projectInventory(root = process.cwd()) {
  const projects = filesUnder(root).filter(file => file.endsWith('/project.json') || file.endsWith('\\project.json')).map(file => {
    const value = JSON.parse(readFileSync(file,'utf8'));
    if (!value.name || !value.sourceRoot) throw new Error('Project requires name/sourceRoot');
    for (const dimension of ['scope:','layer:','runtime:']) {
      if (value.tags?.filter(tag => tag.startsWith(dimension)).length !== 1) throw new Error('Missing/ambiguous project tag: '+ value.name + ' ' + dimension);
    }
    if (!['domain','application','infrastructure','contract','composition','testing'].includes(value.tags.find(tag=>tag.startsWith('layer:')).slice(6))) throw new Error('Invalid layer');
    if (!['edge','cloud','shared','ci'].includes(value.tags.find(tag=>tag.startsWith('runtime:')).slice(8))) throw new Error('Invalid runtime');
    return {...value, file: relative(root,file).replaceAll('\\','/')};
  });
  if (!projects.length || new Set(projects.map(p=>p.name)).size !== projects.length) throw new Error('Missing or duplicate projects');
  const manifests = filesUnder(root).filter(file => /(?:apps|libs)[\\/].*[\\/]package\.json$/.test(file));
  for(const file of manifests) {
    const path=relative(root,file).replaceAll('\\','/').replace(/package.json$/,'project.json');
    if(!projects.some(project=>project.file===path)) throw new Error('Unclassified workspace package: '+path);
  }
  return projects;
}
export function constraints(projects) {
  const scopes=[...new Set(projects.flatMap(p=>p.tags.filter(tag=>tag.startsWith('scope:'))))];
  return [
    { sourceTag:'layer:domain', onlyDependOnLibsWithTags:['layer:domain','layer:contract'], bannedExternalImports:['@nestjs/*','kysely','better-sqlite3','sqlite3','redis','ioredis','bullmq','@aws-sdk/*'] },
    { sourceTag:'layer:contract', onlyDependOnLibsWithTags:['layer:contract'] },
    { sourceTag:'layer:application', onlyDependOnLibsWithTags:['layer:domain','layer:application','layer:contract'] },
    { sourceTag:'runtime:edge', notDependOnLibsWithTags:['runtime:cloud','runtime:ci'], bannedExternalImports:['bullmq','redis','ioredis','@aws-sdk/*'] },
    { sourceTag:'runtime:shared', notDependOnLibsWithTags:['runtime:cloud','runtime:edge','runtime:ci'] },
    { sourceTag:'scope:inventory', notDependOnLibsWithTags:['scope:recipes'] },
    ...scopes.map(scope=>({sourceTag:scope,onlyDependOnLibsWithTags:[scope,'scope:shared','layer:contract']})),
  ];
}
