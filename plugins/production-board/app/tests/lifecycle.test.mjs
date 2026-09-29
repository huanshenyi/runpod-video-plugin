import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createPlan} from '../lib/runpod/plan.mjs';
import {createRunStore} from '../lib/runpod/runs.mjs';
import {createLifecycle} from '../lib/runpod/lifecycle.mjs';
import {createSimulator,createControllerProvider} from '../lib/runpod/execution-adapters.mjs';
async function fixture(t){
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'lifecycle-'));t.after(()=>fs.rm(workspace,{recursive:true,force:true}));
 await fs.mkdir(path.join(workspace,'board'));await fs.mkdir(path.join(workspace,'videos/demo'),{recursive:true});
 await fs.writeFile(path.join(workspace,'board/project.json'),JSON.stringify({revision:1,project:{id:'demo'},items:[{id:'01'}]}));await fs.writeFile(path.join(workspace,'videos/demo/ref.png'),'input');
 const plan=await createPlan({workspace,itemId:'01',prompt:'test',inputs:['videos/demo/ref.png'],operation:'video',modelProfile:{modelId:'h3',revision:'abc123',imageDigest:'sha256:'+'a'.repeat(64),runtime:'python-3.12'},budgetUsd:5,maxHourlyUsd:1,deadlineAt:new Date(Date.now()+3600000).toISOString()});
 const store=createRunStore(workspace);await store.create(plan);const adapters=createSimulator(workspace);const engine=createLifecycle({workspace,store,...adapters,validate:async()=>{},sleep:async()=>{}});
 return {workspace,store,plan,...adapters,engine,counts:async()=>JSON.parse(await fs.readFile(path.join(workspace,'board/runs',plan.runId,'simulation.json')))};
}
test('full run then repeated run/resume/cleanup has one allocation and submission',async t=>{
 const x=await fixture(t),id=x.plan.runId;let r=await x.engine.execute(id);assert.equal(r.status,'complete');assert.equal(r.cleanupStatus,'verified');assert.equal(r.outputs[0].simulation,true);
 for(const command of ['run','resume','cleanup','cleanup'])assert.equal((await x.engine.execute(id,{command})).status,'complete');
 const s=await x.counts();assert.equal(s.allocations,1);assert.equal(s.submissions,1);assert.equal(s.deletions,1);
});
test('resume at each durable stage uses same remote work',async t=>{
 const x=await fixture(t),id=x.plan.runId;
 for(const status of ['allocated','prepared','generating','generated','recovered','validated','complete'])assert.equal((await x.engine.execute(id,{command:'resume',steps:1})).status,status);
 assert.equal((await x.counts()).allocations,1);assert.equal((await x.counts()).submissions,1);
});
test('lost creation response reconciles receipt without another allocation',async t=>{
 const x=await fixture(t),allocate=x.provider.allocate;x.provider.allocate=async r=>{await allocate(r);throw Error('lost reply');};
 assert.equal((await x.engine.execute(x.plan.runId)).status,'complete');assert.equal((await x.counts()).allocations,1);
});
test('unknown allocation never retries or adopts by name',async t=>{
 const x=await fixture(t);let calls=0;x.provider.allocate=async()=>{calls++;throw Error('lost');};x.provider.reconcile=async()=>({status:'unknown'});
 for(let i=0;i<3;i++)assert.equal((await x.engine.execute(x.plan.runId)).status,'reconciliation_required');assert.equal(calls,1);
});
test('lost submission response resumes existing job',async t=>{
 const x=await fixture(t),submit=x.driver.submit;x.driver.submit=async r=>{await submit(r);throw Error('lost reply');};
 assert.equal((await x.engine.execute(x.plan.runId)).status,'submit_pending');
 assert.equal((await x.engine.execute(x.plan.runId,{command:'resume'})).status,'complete');assert.equal((await x.counts()).submissions,1);
});
test('ambiguous pending job never resubmits',async t=>{
 const x=await fixture(t);let calls=0;x.driver.submit=async()=>{calls++;throw Error('lost');};x.driver.reconcile=async()=>({status:'unknown'});
 for(let i=0;i<3;i++)assert.equal((await x.engine.execute(x.plan.runId)).status,'submit_pending');assert.equal(calls,1);
});
test('recovery interruption resumes download, not generation',async t=>{
 const x=await fixture(t),recover=x.driver.recover;let count=0;x.driver.recover=async r=>{if(!count++)throw Error('network');return recover(r);};
 assert.equal((await x.engine.execute(x.plan.runId)).status,'recovering');assert.equal((await x.engine.execute(x.plan.runId)).status,'complete');assert.equal((await x.counts()).submissions,1);
});
test('failed media validation cleans owned resources but never reports success',async t=>{
 const x=await fixture(t);x.driver.validate=async()=>({verified:false});const r=await x.engine.execute(x.plan.runId);assert.equal(r.status,'failed');assert.equal(r.outcome,'validation_failed');assert.equal(r.cleanupStatus,'verified');
});
test('cleanup retries deletion only, deletion absence must be confirmed',async t=>{
 const x=await fixture(t),cleanup=x.provider.cleanup;let count=0;x.provider.cleanup=async r=>{if(!count++)throw Error('timeout');return cleanup(r);};
 assert.equal((await x.engine.execute(x.plan.runId)).status,'cleanup_pending');assert.equal((await x.engine.execute(x.plan.runId,{command:'cleanup'})).status,'complete');assert.equal((await x.counts()).submissions,1);
});
test('explicit cleanup before recovery requires discard and prevents later allocation',async t=>{
 const x=await fixture(t);await x.engine.execute(x.plan.runId,{steps:1});await assert.rejects(x.engine.execute(x.plan.runId,{command:'cleanup'}),/discard/);
 const r=await x.engine.execute(x.plan.runId,{command:'cleanup',discard:true});assert.equal(r.status,'cancelled');assert.equal((await x.engine.execute(x.plan.runId)).status,'cancelled');assert.equal((await x.counts()).allocations,1);
});
test('deadline after allocation triggers cleanup and no generation',async t=>{
 const x=await fixture(t);await x.engine.execute(x.plan.runId,{steps:1});const engine=createLifecycle({...x,validate:async()=>{},now:()=>Date.parse(x.plan.deadlineAt)+1});const r=await engine.execute(x.plan.runId);assert.equal(r.outcome,'budget_exhausted');assert.equal(r.cleanupStatus,'verified');assert.equal((await x.counts()).submissions,undefined);
});
test('simulated state cannot be resumed as live',async t=>{
 const x=await fixture(t);await x.engine.execute(x.plan.runId,{steps:1});await assert.rejects(x.engine.execute(x.plan.runId,{mode:'live'}),/mode is immutable/);
});
test('two command processes cannot own one run lock',async t=>{
 const x=await fixture(t);await x.store.withLock(x.plan.runId,async()=>{await assert.rejects(x.engine.execute(x.plan.runId),/locked/);});
});
test('live controller is mandatory and requires TLS',()=>{
 assert.throws(()=>createControllerProvider({}),/independent/);assert.throws(()=>createControllerProvider({url:'http://localhost:4319',token:'a'.repeat(32)}),/HTTPS/);
});

test('validation exception also cleans resources',async t=>{
 const x=await fixture(t);x.driver.validate=async()=>{throw Error('black video');};const r=await x.engine.execute(x.plan.runId);assert.equal(r.outcome,'validation_failed');assert.equal(r.cleanupStatus,'verified');
});
test('lost local artifact returns to recovery without another submission',async t=>{
 const x=await fixture(t);let r=await x.engine.execute(x.plan.runId,{steps:5});assert.equal(r.status,'recovered');await fs.unlink(path.join(x.workspace,r.outputs[0].path));
 assert.equal((await x.engine.execute(x.plan.runId)).status,'generated');assert.equal((await x.engine.execute(x.plan.runId)).status,'complete');assert.equal((await x.counts()).submissions,1);
});
test('CLI can simulate, resume and clean up end-to-end',async t=>{
 const x=await fixture(t);const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const cli=new URL('../../scripts/runpod.mjs',import.meta.url);
 const invoke=async(cmd,...args)=>JSON.parse((await promisify(execFile)(process.execPath,[cli.pathname,cmd,'--workspace',x.workspace,'--id',x.plan.runId,...args])).stdout);
 assert.equal((await invoke('run','--steps','2')).status,'prepared');assert.equal((await invoke('resume')).status,'complete');assert.equal((await invoke('cleanup')).cleanupStatus,'verified');
});
test('unlock refuses a live owner and recovers a dead same-host owner',async t=>{
 const x=await fixture(t);const lock=path.join(x.workspace,'board/runs',x.plan.runId,'.lock');
 await x.store.withLock(x.plan.runId,async()=>await assert.rejects(x.store.recoverLock(x.plan.runId),/still alive/));
 await fs.writeFile(lock,JSON.stringify({pid:2147483647,hostname:os.hostname()}));assert.deepEqual(await x.store.recoverLock(x.plan.runId),{unlocked:true});assert.equal((await x.engine.execute(x.plan.runId)).status,'complete');
});
test('ready resume rechecks local prerequisites before allocating',async t=>{
 const x=await fixture(t);await x.engine.execute(x.plan.runId,{steps:0});x.driver.preflight=async()=>{throw Error('key removed');};const r=await x.engine.execute(x.plan.runId);assert.equal(r.status,'ready');assert.equal(r.execution.podId,undefined);
});
test('resume discovers externally deleted Pod without further SSH work',async t=>{
 const x=await fixture(t);await x.engine.execute(x.plan.runId,{steps:3});await x.provider.cleanup(await x.store.load(x.plan.runId));x.driver.poll=async()=>{throw Error('must not poll deleted pod');};const r=await x.engine.execute(x.plan.runId);assert.equal(r.outcome,'resource_lost');assert.equal(r.cleanupStatus,'verified');
});
test('Python adapter preserves a failed job response for lifecycle cleanup',async t=>{
 const x=await fixture(t),{createH3Driver}=await import('../lib/runpod/execution-adapters.mjs');const d=createH3Driver({workspace:x.workspace,exec:async()=>({stdout:JSON.stringify({status:'failed'})})});
 assert.deepEqual(await d.poll(await x.store.load(x.plan.runId)),{status:'failed'});
 await assert.rejects(d.validate(await x.store.load(x.plan.runId)),/driver validate failed/);
});
test('controller client refuses malformed health and cleanup-pending allocations',async()=>{
 const run={runId:'8f2118b4-17bc-480d-a7ea-ae10e729a40b',plan:{operation:'video',modelProfile:{imageDigest:'sha256:'+'a'.repeat(64)},executionConfig:{provision:{image:'sha256:'+'a'.repeat(64)}}}};
 let payload={ready:true,service:'runpod-deadline-controller',now:'invalid'};
 const p=createControllerProvider({url:'https://controller.example',token:'t'.repeat(32),fetcher:async()=>({ok:true,json:async()=>payload})});
 await assert.rejects(p.preflight(run),/not ready/);
 payload={status:'cleanup_pending',pod:{id:'pod1',costPerHr:1}};
 await assert.rejects(p.allocate(run),/unknown/);assert.equal((await p.reconcile(run)).status,'unknown');await assert.rejects(p.inspect(run),/not active/);
});
