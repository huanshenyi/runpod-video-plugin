import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareRuntime} from '../../scripts/runtime.mjs';
test('onboarding builds outside plugin and reuses only matching complete runtime',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'onboard-test-'));
 try{
  const plugin=path.join(temp,'plugin'),root=path.join(temp,'data');await mkdir(path.join(plugin,'app'),{recursive:true});
  await writeFile(path.join(plugin,'app/package-lock.json'),'{}');let calls=0;
  const run=async(_program,args,cwd)=>{calls++;if(args[0]==='run'){await mkdir(path.join(cwd,'dist'),{recursive:true});await writeFile(path.join(cwd,'dist/index.html'),'ready');}};
  const a=await prepareRuntime({plugin,root,run});assert.equal(calls,2);assert.equal(a.reused,false);assert(a.runtime.startsWith(root));
  const b=await prepareRuntime({plugin,root,run});assert.equal(b.reused,true);assert.equal(calls,2);
  await writeFile(path.join(plugin,'app/package-lock.json'),'{"updated":true}');
  const c=await prepareRuntime({plugin,root,run});assert.notEqual(c.runtime,a.runtime);assert.equal(calls,4);
  assert.equal(await readFile(path.join(a.runtime,'app/package-lock.json'),'utf8'),'{}');
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('failed setup does not mark runtime ready and can retry',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'onboard-failure-'));
 try{
  const plugin=path.join(temp,'plugin');await mkdir(plugin);await writeFile(path.join(plugin,'plugin.json'),'{}');
  const root=path.join(temp,'data');await assert.rejects(prepareRuntime({plugin,root,run:async()=>{throw Error('install failed');}}),/install failed/);
  const result=await prepareRuntime({plugin,root,run:async(_p,_a,cwd)=>{await mkdir(path.join(cwd,'dist'),{recursive:true});await writeFile(path.join(cwd,'dist/index.html'),'ok');}});
  assert.equal(result.reused,false);
 }finally{await rm(temp,{recursive:true,force:true});}
});
