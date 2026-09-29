import {createHash} from 'node:crypto';
import {createReadStream, promises as fs} from 'node:fs';
import path from 'node:path';

const terminal=new Set(['complete','failed','cancelled']);
const safeCode=e=>/^[a-z_]{1,60}$/.test(e?.code||'')?e.code:'operation_failed';
export async function verifyLocalArtifact(workspace,artifact){
 if(!artifact||typeof artifact.path!=='string'||path.isAbsolute(artifact.path)||artifact.path.split(/[\\/]/).some(p=>p==='..')||!/^[a-f0-9]{64}$/.test(artifact.sha256||''))throw Error('Invalid recovered artifact');
 const root=await fs.realpath(workspace),file=await fs.realpath(path.join(root,artifact.path));
 if(!file.startsWith(root+path.sep)||(await fs.stat(file)).size===0)throw Error('Invalid recovered artifact');
 const hash=createHash('sha256');for await(const b of createReadStream(file))hash.update(b);
 if(hash.digest('hex')!==artifact.sha256)throw Error('Recovered artifact hash mismatch');
 return true;
}

// Provider owns allocation/deletion; driver owns one durable remote job per runId.
export function createLifecycle({store,workspace,provider,driver,validate,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 async function execute(id,{command='run',steps=Infinity,discard=false,mode='simulate'}={}){
  return store.withLock(id,async()=>{
   let r=await store.load(id);
   if(r.execution?.mode&&r.execution.mode!==mode)throw Error('Run mode is immutable');
   if(r.execution?.providerIdentity&&r.execution.providerIdentity!==provider.identity)throw Error('Run controller identity is immutable');
   const save=async(status,detail={})=>{
    const time=new Date(now()).toISOString();
    if(status!==r.status){const prev=r.events.at(-1);if(prev&&!prev.endedAt)prev.endedAt=time;r.events.push({phase:status,startedAt:time});}
    delete r.error;Object.assign(r,detail,{status});r=await store.save(r);return r;
   };
   const estimate=()=>{
    if(!r.execution?.allocationStartedAt)return;
    const end=r.execution.deletedAt?Date.parse(r.execution.deletedAt):now();
    const hours=Math.max(0,end-Date.parse(r.execution.allocationStartedAt))/3600000;
    const rate=r.execution.costPerHr??r.plan.maxHourlyUsd;
    r.estimatedCostUsd=hours*(rate+(r.plan.executionConfig?.storageHourlyUsd??0));
   };
   async function reconcileCreation(){
    const found=await provider.reconcile(r);
    if(found.status==='found'&&found.pod?.id){
     r.execution.podId=found.pod.id;r.execution.costPerHr=found.pod.costPerHr;
     r.resources=[{type:'pod',id:found.pod.id,status:'active',ownership:'creation_receipt',attachedDisks:true}];
     await save('allocated');
    }else if(found.status==='not_created'){await save('failed',{outcome:'provisioning_failed',cleanupStatus:'not_created'});return false;}else if(found.status==='deleted'){r.execution.deletedAt=new Date(now()).toISOString();await save('failed',{outcome:'resource_lost',cleanupStatus:'verified'});}
    else{await save('reconciliation_required',{error:{code:'creation_outcome_unknown'}});return false;}
    return true;
   }
   async function cleanup(outcome){
    if(!r.execution)return save('cancelled',{outcome:'cancelled',cleanupStatus:'not_created'});
    if(!r.execution.podId&&r.execution.allocationStartedAt){
     if(!await reconcileCreation())return r;
    }
    if(!r.execution.podId)return save(outcome==='success'?'complete':outcome==='cancelled'?'cancelled':'failed',{outcome,cleanupStatus:'not_created'});
    await save('cleanup_pending',{outcome,cleanupStatus:'pending'});
    try{
     const result=await provider.cleanup(r);
     if(result.status!=='deleted'){await save('cleanup_pending',{error:{code:'deletion_not_verified'}});return r;}
     r.execution.deletedAt=new Date(now()).toISOString();r.resources=r.resources.map(x=>({...x,status:'deleted'}));estimate();
     const endedAt=new Date(now()).toISOString();
     await save(outcome==='success'?'complete':outcome==='cancelled'?'cancelled':'failed',{outcome,cleanupStatus:'verified',cleanupVerifiedAt:endedAt});
     r.events.at(-1).endedAt=endedAt;return await store.save(r);
    }catch(e){return save('cleanup_pending',{error:{code:safeCode(e)}});}
   }
   if(command==='cleanup'){
    if(r.cleanupStatus==='verified')return r;
    if(r.execution?.podId&&r.outcome!=='success'&&r.status!=='validated'&&!discard)throw Error('Output is not verified. Use --discard true to explicitly abandon it.');
    return cleanup(r.outcome??(r.status==='validated'?'success':'cancelled'));
   }
   if(terminal.has(r.status))return r;
   if(r.status==='cleanup_pending')return cleanup(r.outcome??'failed');
   if(r.status==='planned'){
    await validate(r.plan);
    await driver.preflight(r);
    r.execution={mode,jobToken:r.runId,providerIdentity:provider.identity};await save('ready');
   }
   if(r.execution?.podId&&['allocated','preparing','prepared','submit_pending','generating','generated','recovering'].includes(r.status)){
    try{if(!await provider.inspect(r))return cleanup('resource_lost');}catch(e){return save(r.status,{error:{code:safeCode(e)}});}
   }
   for(let n=0;n<steps;n++){
    estimate();
    if(now()>=Date.parse(r.plan.deadlineAt)||(r.estimatedCostUsd??0)>=r.plan.budgetUsd)return cleanup('budget_exhausted');
    try{
     if(r.status==='ready'){
      await validate(r.plan);await driver.preflight(r);await provider.preflight(r);
      r.execution.allocationStartedAt=new Date(now()).toISOString();await save('create_pending');
      // Intent is durable before allocation. An uncertain reply is never repeated.
      try{
       const pod=await provider.allocate(r);
       if(!pod?.id)throw Error('Missing creation receipt');
       r.execution.podId=pod.id;r.execution.costPerHr=pod.costPerHr;
       r.resources=[{type:'pod',id:pod.id,status:'active',ownership:'creation_receipt',attachedDisks:true}];await save('allocated');
      }catch(e){if(e.id){r.execution.podId=e.id;r.resources=[{type:'pod',id:e.id,status:'unknown',ownership:'creation_receipt',attachedDisks:true}];await save('allocated');}else{await save('create_pending',{error:{code:safeCode(e)}});if(!await reconcileCreation())return r;}}
     }else if(['create_pending','reconciliation_required'].includes(r.status)){
      if(!await reconcileCreation())return r;
     }else if(['allocated','preparing'].includes(r.status)){
      const pod=await provider.inspect(r);
      if(!pod) return cleanup('resource_lost');
      if(!Number.isFinite(pod.costPerHr)||pod.costPerHr>r.plan.maxHourlyUsd)return cleanup('price_rejected');
      r.execution.costPerHr=pod.costPerHr;await save('preparing');await driver.prepare(r);await save('prepared');
     }else if(r.status==='prepared'){
      await save('submit_pending');
      const result=await driver.submit(r);
      const id=result.jobId??result.promptId;if(!id)throw Error('Missing job receipt');
      r.execution.jobId=id;await save('generating');
     }else if(r.status==='submit_pending'){
      const result=await driver.reconcile(r);
      const id=result.jobId??result.promptId;
      if(result.status==='found'&&id){r.execution.jobId=id;await save('generating');}
      else if(result.status==='absent'){await save('prepared');}
      else return save('submit_pending',{error:{code:'job_outcome_unknown'}});
     }else if(r.status==='generating'){
      const result=await driver.poll(r);
      if(['succeeded','complete'].includes(result.status)){r.execution.artifact=result.artifact??result.artifacts;await save('generated');}
      else if(result.status==='failed')return cleanup('generation_failed');
      else if(result.status==='running'){await save('generating');if(n+1<steps)await sleep(2000);}
      else throw Error('Invalid job status');
     }else if(['generated','recovering'].includes(r.status)){
      await save('recovering');const result=await driver.recover(r);const outputs=result.artifacts??[result];
      if(!outputs.length)throw Error('No recovered output');
      for(const a of outputs)await verifyLocalArtifact(workspace,a);
      await save('recovered',{outputs});
     }else if(['recovered','validating'].includes(r.status)){
      try{for(const a of r.outputs)await verifyLocalArtifact(workspace,a);}catch{return save('generated',{error:{code:'local_artifact_missing_or_changed'}});}
      await save('validating');let result;try{result=await driver.validate(r);}catch{return cleanup('validation_failed');}
      if(result.verified!==true&&result.status!=='validated')return cleanup('validation_failed');
      await save('validated',{outcome:'success'});
     }else if(r.status==='validated')return cleanup('success');
     else throw Error('Unsupported run state');
    }catch(e){
     // Submission ambiguity must be reconciled; never retry POST from this catch.
     if(r.status==='submit_pending')return save('submit_pending',{error:{code:'job_outcome_unknown'}});
     await save(r.status,{error:{code:safeCode(e)}});
     // Transient failures are resumable; independent controller still owns deadline.
     return r;
    }
   }
   return r;
  });
 }
 return {execute};
}
