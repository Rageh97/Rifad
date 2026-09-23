import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';
import { projectInventory, constraints } from './tools/architecture-policy.mjs';

const projects=projectInventory();
export default [
  { ignores:['**/node_modules/**','**/dist/**','.nx/**','.tools/**','.test-artifacts/**','docs/architecture/generated/**'] },
  ...tseslint.configs.recommended,
  {
    files:['**/*.ts','**/*.mjs'],
    rules:{
      '@typescript-eslint/no-explicit-any':'error',
      '@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_'}],
      'no-debugger':'error',
      'no-eval':'error',
    },
  },
  {
    files:['apps/**/*.ts','libs/**/*.ts'],
    plugins:{'@nx':nx},
    rules:{
      '@nx/enforce-module-boundaries':['error',{allow:[],depConstraints:constraints(projects)}],
      'no-restricted-imports':['error',{patterns:[{group:['@rifad/*/*'],message:'Use a public context entry point.'}]}],
    },
  },
  ...projects.filter(p=>p.tags.includes('layer:domain') || p.tags.includes('runtime:edge')).map(p=>({
    files:[p.sourceRoot+'/**/*.ts'],
    rules:{
      'no-restricted-imports':['error',{patterns:[
        {group:['@rifad/*/*'],message:'Private imports forbidden'},
        ...(p.tags.includes('layer:domain') ? [{group:['@nestjs/*','kysely','better-sqlite3','sqlite3','redis','ioredis','bullmq','@aws-sdk/*'],message:'Domain infrastructure import forbidden'}] : []),
        ...(p.tags.includes('runtime:edge') ? [{group:['bullmq','redis','ioredis','@aws-sdk/*'],message:'Edge Cloud-only dependency forbidden'}] : []),
      ]}],
    },
  })),
];
