import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPlan, validatePlan } from '../lib/runpod/plan.mjs';
import { createRunStore } from '../lib/runpod/runs.mjs';
import { renderReport } from '../lib/runpod/report.mjs';
async function fixture(t) {
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'runpod-state-'));t.after(()=>fs.rm(workspace,{recursive:true,force:true}));
 await fs.mkdir(path.join(workspace,'board'));await fs.mkdir(path.join(workspace,'videos/demo'),{recursive:true});
 await fs.writeFile(path.join(workspace,'videos/demo/ref.png'),'reference');
 await fs.writeFile(path.join(workspace,'board/project.json'),JSON.stringify({revision:1,project:{id:'demo'},items:[{id:'01'}]}));
 return {workspace,itemId:'01',prompt:'An anime scene',inputs:['videos/demo/ref.png'],modelProfile:{modelId:'model/test',revision:'abc123',imageDigest:'registry/image@sha256:'+'a'.repeat(64),runtime:'python-3.12.9'},budgetUsd:2,maxHourlyUsd:1,deadlineAt:new Date(Date.now()+3600000).toISOString()};
}
test('planning is read-only, pins inputs, and rejects changed board or materials',async t=>{
 const args=await fixture(t),plan=await createPlan(args);assert.equal(plan.inputs[0].sha256.length,64);assert.equal(await validatePlan({workspace:args.workspace,plan}),true);
 await assert.rejects(fs.stat(path.join(args.workspace,'board/runs')), {code:'ENOENT'});
 await fs.writeFile(path.join(args.workspace,args.inputs[0]),'changed');await assert.rejects(validatePlan({workspace:args.workspace,plan}),/changed/);
 await fs.writeFile(path.join(args.workspace,args.inputs[0]),'reference');await fs.writeFile(path.join(args.workspace,'board/project.json'),JSON.stringify({revision:2,project:{id:'demo'},items:[{id:'01'}]}));await assert.rejects(validatePlan({workspace:args.workspace,plan}),/revision/);
});
test('invalid budgets, unpinned profiles, path escapes and expired plans fail closed',async t=>{
 const args=await fixture(t);for(const patch of [{budgetUsd:-1},{maxHourlyUsd:0},{prompt:''},{inputs:[]},{inputs:['../secret.png']},{modelProfile:{...args.modelProfile,revision:'latest'}},{deadlineAt:'2000-01-01T00:00:00Z'}])await assert.rejects(createPlan({...args,...patch}));
 await fs.symlink(os.tmpdir(),path.join(args.workspace,'videos/demo/escape'));await assert.rejects(createPlan({...args,inputs:['videos/demo/escape/out.png']}));
});
test('durable run store rejects duplicates and cross-store lock contenders',async t=>{
 const args=await fixture(t),plan=await createPlan(args),store=createRunStore(args.workspace),other=createRunStore(args.workspace);
 const run=await store.create(plan);assert.equal(run.status,'planned');await assert.rejects(store.create(plan),/exist/);
 await store.withLock(plan.runId,async()=>{await assert.rejects(other.withLock(plan.runId,()=>{}),/locked/);
 const code=`import {createRunStore} from ${JSON.stringify(new URL('../lib/runpod/runs.mjs',import.meta.url).href)};try{await createRunStore(process.argv[1]).withLock(process.argv[2],()=>{});process.exit(1);}catch(e){if(!/locked/.test(e.message))throw e;}`;
 await promisify(execFile)(process.execPath,['--input-type=module','-e',code,args.workspace,plan.runId]);run.status='running';await store.save(run);});
 await assert.rejects(store.save({...run,schemaVersion:2}),/schema/);
 assert.equal((await other.load(plan.runId)).status,'running');assert.equal((await store.list()).length,1);
 await assert.rejects(store.load('../escape'));await assert.rejects(store.withLock('../escape',()=>{}));
 await assert.rejects(store.withLock(plan.runId,()=>{throw Error('failure');}),/failure/);await store.withLock(plan.runId,()=>{});
});
test('run storage rejects symlinked directories',async t=>{
 const args=await fixture(t),plan=await createPlan(args);await fs.symlink(os.tmpdir(),path.join(args.workspace,'board/runs'));await assert.rejects(createRunStore(args.workspace).create(plan),/symbolic|directory/);
});
test('report distinguishes estimate from unknown billing and lists remaining resources',()=>{
 const report=renderReport({runId:'test',status:'cleanup_pending',resources:[{id:'pod-1',type:'pod',status:'running'}],events:[],outputs:[],estimatedCostUsd:0.25});
 assert.match(report,/pod-1/);assert.match(report,/0.25/);assert.match(report,/未確認/);assert.match(report,/cleanup_pending/);
});

test('planning rejects symlinked board and external project roots',async t=>{
 const args=await fixture(t);await fs.rename(path.join(args.workspace,'board'),path.join(args.workspace,'actual-board'));await fs.symlink(path.join(args.workspace,'actual-board'),path.join(args.workspace,'board'));await assert.rejects(createPlan(args),/symbolic/);
 await fs.unlink(path.join(args.workspace,'board'));await fs.rename(path.join(args.workspace,'actual-board'),path.join(args.workspace,'board'));await fs.rename(path.join(args.workspace,'videos/demo'),path.join(args.workspace,'original-demo'));await fs.symlink(os.tmpdir(),path.join(args.workspace,'videos/demo'));await assert.rejects(createPlan(args),/escapes/);
});

test('incomplete initialization remains visible without hiding healthy runs',async t=>{
 const args=await fixture(t),healthyPlan=await createPlan(args),incompletePlan=await createPlan(args),store=createRunStore(args.workspace);
 await store.create(healthyPlan);
 await fs.mkdir(path.join(args.workspace,'board/runs',incompletePlan.runId));
 const listed=await store.list();assert.equal(listed.length,2);
 assert.equal(listed.find(run=>run.runId===healthyPlan.runId).status,'planned');
 assert.deepEqual(listed.find(run=>run.runId===incompletePlan.runId),{schemaVersion:1,runId:incompletePlan.runId,status:'initialization_incomplete',resources:[],events:[],outputs:[]});
 await assert.rejects(store.create(incompletePlan),/initialization incomplete.*recovery/i);
 assert.equal((await fs.stat(path.join(args.workspace,'board/runs',incompletePlan.runId))).isDirectory(),true);
});
