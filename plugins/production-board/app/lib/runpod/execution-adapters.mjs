import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const call=promisify(execFile);

// Simulation state is persisted separately from run state to exercise crash reconciliation.
export function createSimulator(workspace){
 const fileFor=r=>path.join(workspace,'board/runs',r.runId,'simulation.json');
 async function read(r){try{return JSON.parse(await fs.readFile(fileFor(r),'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
 async function write(r,s){const f=fileFor(r),tmp=f+'.tmp';await fs.writeFile(tmp,JSON.stringify(s),{mode:0o600});await fs.rename(tmp,f);}
 const provider={
  identity:'local-simulator',
  async preflight(){},
  async allocate(r){const s=await read(r);if(s.pod)return s.pod;if(s.deleted)throw Error('Simulation already terminated');s.pod={id:'sim-'+r.runId,name:'production-board-'+r.runId,costPerHr:Math.min(.1,r.plan.maxHourlyUsd)};s.allocations=(s.allocations??0)+1;await write(r,s);return s.pod;},
  async reconcile(r){const s=await read(r);return s.deleted?{status:'deleted'}:s.pod?{status:'found',pod:s.pod}:{status:'unknown'};},
  async inspect(r){return (await read(r)).pod??null;},
  async cleanup(r){const s=await read(r);if(!s.deleted){s.pod=null;s.deleted=true;s.deletions=(s.deletions??0)+1;await write(r,s);}return {status:'deleted'};}
 };
 const driver={
  async preflight(){},async prepare(){return {ready:true};},
  async submit(r){const s=await read(r);if(!s.jobId){s.jobId='sim-job-'+r.runId;s.submissions=(s.submissions??0)+1;await write(r,s);}return {jobId:s.jobId};},
  async reconcile(r){const s=await read(r);return s.jobId?{status:'found',jobId:s.jobId}:{status:'absent'};},
  async poll(){return {status:'succeeded'};},
  async recover(r){const relative=`board/runs/${r.runId}/simulation-output.txt`,data=Buffer.from('SIMULATION ONLY — not generated media\n');await fs.writeFile(path.join(workspace,relative),data);return {artifacts:[{path:relative,sha256:createHash('sha256').update(data).digest('hex'),simulation:true}]};},
  async validate(){return {verified:true,simulation:true};}
 };
 return {provider,driver};
}
export function createControllerProvider({url,token,fetcher=fetch}){
 if(!url||!token||token.length<32)throw Error('Live execution requires an independent deadline controller URL and token');
 const origin=new URL(url);if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash)throw Error('Deadline controller must use HTTPS without URL credentials');
 async function request(method,route,body){
  const response=await fetcher(new URL(route,origin),{method,redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw Error('Deadline controller request failed');return response.json();
 }
 function route(r){return '/runs/'+encodeURIComponent(r.runId);}
 return {
  identity:origin.origin,
  async preflight(r){
   if(r.plan.operation!=='video')throw Error('Live runner currently supports H3 video only');
   if(r.plan.executionConfig?.provision?.image!==r.plan.modelProfile.imageDigest)throw Error('Provision image must equal the pinned modelProfile.imageDigest');
   if(!r.plan.executionConfig?.provision)throw Error('Live plan requires executionConfig.provision');
   const health=await request('GET','/health');
   if(health.ready!==true||health.service!=='runpod-deadline-controller'||!Number.isFinite(Date.parse(health.now))||Math.abs(Date.parse(health.now)-Date.now())>60000)throw Error('Deadline controller is not ready or clock differs');
  },
  async allocate(r){
   const body={runId:r.runId,deadlineAt:r.plan.deadlineAt,plan:{runId:r.runId,executionAuthorized:true,provision:r.plan.executionConfig.provision,maxHourlyUsd:r.plan.maxHourlyUsd,budgetUsd:r.plan.budgetUsd,storageHourlyUsd:r.plan.executionConfig.storageHourlyUsd}};
   const result=await request('POST','/runs',body);if(result.status!=='active'||!result.pod?.id)throw Error('Creation outcome unknown or already cleaned');return result.pod;
  },
  async reconcile(r){const result=await request('GET',route(r));return result.status==='failed'&&!result.pod?{status:'not_created'}:result.status==='deleted'?{status:'deleted'}:result.status==='active'&&result.pod?{status:'found',pod:result.pod}:{status:'unknown'};},
  async inspect(r){const result=await request('GET',route(r));if(result.status==='deleted')return null;if(result.status!=='active')throw Error('Controller resource is not active');return result.pod;},
  async cleanup(r){const result=await request('DELETE',route(r));return {status:result.status==='deleted'?'deleted':'pending'};}
 };
}
export function createH3Driver({workspace,python='python3',binary='runpodctl',exec=call}){
 const script=fileURLToPath(new URL('../../../scripts/h3-driver.py',import.meta.url));
 async function invoke(action,r){
  const dir=path.join(workspace,'board/runs',r.runId),file=path.join(dir,`.driver-${randomUUID()}.json`);
  await fs.writeFile(file,JSON.stringify({workspace,run:r,runpodctl:binary}),{flag:'wx',mode:0o600});
  try{
   const remaining=Date.parse(r.plan.deadlineAt)-Date.now();
   const timeout=Math.max(1000,Math.min(1800000,remaining));
   const {stdout}=await exec(python,[script,action,'--request',file],{timeout,maxBuffer:2*1024*1024,encoding:'utf8',env:{...process.env,RUNPODCTL_BIN:binary}});
   const result=JSON.parse(stdout);if((result.status==='failed'&&action!=='poll')||result.status==='rejected')throw Error('H3 driver rejected operation');return result;
  }catch{throw Error(`H3 driver ${action} failed; inspect run state before resume`);}
  finally{await fs.rm(file,{force:true});}
 }
 return {preflight:r=>invoke('preflight',r),prepare:r=>invoke('prepare',r),submit:r=>invoke('submit',r),reconcile:r=>invoke('reconcile-job',r),poll:r=>invoke('poll',r),recover:r=>invoke('recover',r),validate:r=>invoke('validate',r)};
}
