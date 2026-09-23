import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function unusedPort() {
  const server=createServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
function launch(runtime,extra={}) {
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('RIFAD_') && key!=='NODE_OPTIONS'));
  Object.assign(env,{RIFAD_ENV:'test',NODE_ENV:'test'},extra);
  const child=fork(resolve('apps',runtime,'dist/main.js'),[],{
    env,silent:true,execArgv:['--import',pathToFileURL(resolve('libs/shared/testing/smoke/loopback-only.mjs')).href],
  });
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const exited=new Promise((resolve,reject)=>{child.once('exit',(code,signal)=>resolve({code,signal}));child.once('error',reject);});
  return {child,exited,output:()=>({stdout,stderr})};
}
async function within(promise,milliseconds) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Test deadline exceeded')),milliseconds);})]); }
  finally { clearTimeout(timer); }
}
async function ready(processState,port) {
  const start=Date.now();
  while(Date.now()-start<15000) {
    if(processState.child.exitCode!==null) throw new Error('Child exited: '+JSON.stringify(processState.output()));
    try {
      const response=await fetch('http://127.0.0.1:'+port+'/health/live',{signal:AbortSignal.timeout(500)});
      if(response.ok) return await response.json();
    } catch { /* Startup can precede listen. */ }
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('Startup deadline exceeded: '+JSON.stringify(processState.output()));
}
for(const runtime of ['edge','api','worker']) {
  test(runtime+' independently starts without other services or outbound TCP', {timeout:25000}, async()=>{
    const port=await unusedPort();
    const state=launch(runtime,{RIFAD_PORT:String(port)});
    try {
      assert.deepEqual(await ready(state,port),{status:'alive',runtime,capability:'batch-1-liveness-only'});
      const missing=await fetch('http://127.0.0.1:'+port+'/api/v1/checks');
      assert.equal(missing.status,404);
      state.child.send('shutdown');
      assert.equal((await within(state.exited,5000)).code,0);
      assert.equal(state.output().stderr,'');
    } finally { if(state.child.exitCode===null) {state.child.kill();await within(state.exited,5000);} }
  });
}
test('invalid sensitive configuration fails safely without echoing values', {timeout:15000},async()=>{
  const canary=['synthetic','private','configuration'].join('-');
  const state=launch('edge',{RIFAD_PORT:canary});
  try {
    assert.equal((await within(state.exited,10000)).code,1);
    const output=JSON.stringify(state.output());
    assert.ok(output.includes('INVALID_CONFIG'));
    assert.ok(!output.includes(canary));
  } finally {if(state.child.exitCode===null) state.child.kill();}
});
test('occupied port fails nonzero without framework stack leakage', {timeout:15000},async()=>{
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const state=launch('edge',{RIFAD_PORT:String(server.address().port)});
  try {
    assert.equal((await within(state.exited,10000)).code,1);
    const {stderr}=state.output();
    assert.match(stderr,/STARTUP_FAILED/);
    assert.ok(!stderr.includes(' at '));
  } finally {
    if(state.child.exitCode===null) state.child.kill();
    await new Promise(resolve=>server.close(resolve));
  }
});
