import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function validId(id){if(typeof id!=='string'||!UUID.test(id))throw new Error('Invalid run ID');return id;}
// Locks deliberately have no age-based override. A crashed writer needs explicit inspection.
export function createRunStore(workspace){
 async function directory(parts,create=false){
  let current=await fs.realpath(workspace);
  for(const part of ['board','runs',...parts]){
   current=path.join(current,part);
   if(create)try{await fs.mkdir(current);}catch(e){if(e.code!=='EEXIST')throw e;}
   const stat=await fs.lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Run storage must be a real directory, not a symbolic link');
  }
  return current;
 }
 async function load(runId){
  const dir=await directory([validId(runId)]);const file=path.join(dir,'run.json');
  if(!(await fs.lstat(file)).isFile())throw new Error('Invalid run file');
  const run=JSON.parse(await fs.readFile(file,'utf8'));if(run.runId!==runId||run.schemaVersion!==1)throw new Error('Invalid stored run');return run;
 }
 async function save(run){
  if(run?.schemaVersion!==1||run?.plan?.runId!==run?.runId)throw new Error('Invalid run schema or plan ID');
  const current=await load(validId(run?.runId));if(JSON.stringify(current.plan)!==JSON.stringify(run.plan))throw new Error('Run plan is immutable');
  const dir=await directory([run.runId]);const temporary=path.join(dir,`.run-${randomUUID()}.tmp`);
  const next={...run,schemaVersion:current.schemaVersion,runId:current.runId,createdAt:current.createdAt,updatedAt:new Date().toISOString()};
  try{const h=await fs.open(temporary,'wx',0o600);try{await h.writeFile(JSON.stringify(next,null,2)+'\n');await h.sync();}finally{await h.close();}await fs.rename(temporary,path.join(dir,'run.json'));const dh=await fs.open(dir,'r');try{await dh.sync();}finally{await dh.close();}}finally{await fs.rm(temporary,{force:true});}
  return next;
 }
 async function withLock(runId,work){
  const dir=await directory([validId(runId)]);const lock=path.join(dir,'.lock');
  let handle;try{handle=await fs.open(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error('Run is locked; inspect owner before manual recovery');throw e;}
  try{try{await fs.lstat(path.join(dir,'.recover-lock'));throw new Error('Run is locked for recovery');}catch(e){if(e.code!=='ENOENT')throw e;}await handle.writeFile(JSON.stringify({pid:process.pid,hostname:os.hostname(),createdAt:new Date().toISOString()}));await handle.sync();return await work();}finally{await handle.close();await fs.unlink(lock);}
 }
 async function create(plan){
  const runId=validId(plan?.runId);if(plan.schemaVersion!==1)throw new Error('Invalid plan schema');
  const root=await directory([],true);const dir=path.join(root,runId);
  try{await fs.mkdir(dir);}catch(e){
   if(e.code!=='EEXIST')throw e;
   await directory([runId]);
   try{await fs.lstat(path.join(dir,'run.json'));}catch(statError){
    if(statError.code==='ENOENT')throw new Error('Run initialization incomplete; manual recovery required before reusing this run ID');
    throw statError;
   }
   throw new Error('Run already exists');
  }
  const now=new Date().toISOString();const run={schemaVersion:1,runId,plan:structuredClone(plan),status:'planned',resources:[],events:[],outputs:[],createdAt:now,updatedAt:now};
  const temporary=path.join(dir,'.initial.tmp');await fs.writeFile(temporary,JSON.stringify(run,null,2)+'\n',{flag:'wx',mode:0o600});await fs.rename(temporary,path.join(dir,'run.json'));return run;
 }
 async function list(){let root;try{root=await directory([]);}catch(e){if(e.code==='ENOENT')return [];throw e;}const entries=await fs.readdir(root);return Promise.all(entries.filter(id=>UUID.test(id)).sort().map(async runId=>{
   const dir=await directory([runId]);
   try{await fs.lstat(path.join(dir,'run.json'));}catch(error){
    if(error.code!=='ENOENT')throw error;
    return {schemaVersion:1,runId,status:'initialization_incomplete',resources:[],events:[],outputs:[]};
   }
   return load(runId);
  }));}
 async function recoverLock(runId){
  const dir=await directory([validId(runId)]),guard=path.join(dir,'.recover-lock'),lock=path.join(dir,'.lock');
  const h=await fs.open(guard,'wx',0o600);
  try{
   let owner;try{owner=JSON.parse(await fs.readFile(lock,'utf8'));}catch(e){if(e.code==='ENOENT')return {unlocked:false};throw e;}
   if(owner.hostname!==os.hostname()||!Number.isSafeInteger(owner.pid)||owner.pid<1)throw Error('Unknown lock owner; manual inspection required');
   try{process.kill(owner.pid,0);throw Error('Lock owner is still alive');}catch(e){if(e.code!=='ESRCH')throw e;}
   await fs.unlink(lock);return {unlocked:true};
  }finally{await h.close();await fs.unlink(guard);}
 }
 return {create,load,save,withLock,list,recoverLock};
}
