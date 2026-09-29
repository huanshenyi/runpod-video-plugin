import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function check(value,message){if(!value)throw new Error(message);}
async function board(workspace){
 const root=await fs.realpath(workspace);
 const folder=path.join(root,'board'),file=path.join(folder,'project.json');
 check((await fs.lstat(folder)).isDirectory()&&(await fs.lstat(file)).isFile(),'Board must use real files and directories, not symbolic links');
 return JSON.parse(await fs.readFile(file,'utf8'));
}
function bounded(plan){
 check(plan?.schemaVersion===1&&UUID.test(plan.runId),'Invalid plan ID or schema');
 check(Number.isSafeInteger(plan.boardRevision)&&plan.boardRevision>0,'Invalid board revision');
 check(['image','video'].includes(plan.operation),'Invalid operation');
 check(typeof plan.prompt==='string'&&plan.prompt.trim().length>0&&plan.prompt.length<=20000,'Prompt is required (max 20000 characters)');
 check(Number.isSafeInteger(plan.seed)&&plan.seed>=0&&plan.seed<=4294967295,'Invalid seed');
 for(const field of ['budgetUsd','maxHourlyUsd'])check(Number.isFinite(plan[field])&&plan[field]>0&&plan[field]<=1000000,`Invalid ${field}`);
 check(typeof plan.deadlineAt==='string'&&Number.isFinite(Date.parse(plan.deadlineAt))&&Date.parse(plan.deadlineAt)>Date.now()&&Date.parse(plan.deadlineAt)<=Date.now()+7*86400000,'Deadline must be in the next 7 days');
 const profile=plan.modelProfile;
 for(const field of ['modelId','revision','imageDigest','runtime'])check(typeof profile?.[field]==='string'&&profile[field].trim().length>0&&profile[field].length<=1000&&!/\b(latest|main|master|head)\b/i.test(profile[field]),`Pinned modelProfile.${field} is required`);
 check(/^(?:[^\s]+@)?sha256:[a-f0-9]{64}$/i.test(profile.imageDigest),'Container imageDigest must be a SHA-256 digest');
 check(plan.cleanupPolicy==='terminate-owned-pod-after-recovery','Unsupported cleanup policy');
 check(Array.isArray(plan.inputs)&&plan.inputs.length>0&&plan.inputs.length<=32,'One to 32 input media files are required');
 check(new Set(plan.inputs.map(i=>i.path)).size===plan.inputs.length,'Duplicate input paths');
}
async function fingerprint(workspace,relative,projectId){
 check(typeof projectId==='string'&&/^[a-zA-Z0-9_-]+$/.test(projectId),'Invalid project ID');
 check(typeof relative==='string'&&!relative.includes('\\')&&!relative.includes('\0')&&!path.isAbsolute(relative)&&!relative.split('/').some(p=>p==='..'||p.startsWith('.'))&&relative.startsWith(`videos/${projectId}/`)&&/\.(png|jpe?g|webp|gif|avif|mp4|webm|mov)$/i.test(relative),'Input must be a relative project media path');
 const workspaceRoot=await fs.realpath(workspace);
 const root=await fs.realpath(path.join(workspace,'videos',projectId));
 check(root.startsWith(workspaceRoot+path.sep),'Project directory escapes workspace');
 const actual=await fs.realpath(path.join(workspace,relative));
 check(actual.startsWith(root+path.sep),'Input escapes project directory');
 const stat=await fs.stat(actual);check(stat.isFile()&&stat.size>0,'Input must be a nonempty file');
 const hash=createHash('sha256');for await(const chunk of createReadStream(actual))hash.update(chunk);
 const after=await fs.stat(actual);
 check(after.ino===stat.ino&&after.size===stat.size&&after.mtimeMs===stat.mtimeMs&&after.ctimeMs===stat.ctimeMs,'Input material changed while hashing');
 return {path:relative,sha256:hash.digest('hex'),sizeBytes:stat.size};
}
export async function createPlan({workspace,itemId,prompt,inputs,modelProfile,budgetUsd,maxHourlyUsd,deadlineAt,seed=0,operation='image'}){
 const state=await board(workspace);
 const plan={schemaVersion:1,runId:randomUUID(),boardRevision:state.revision,projectId:state.project?.id,itemId,operation,modelProfile:structuredClone(modelProfile),inputs:Array.isArray(inputs)?inputs.map(input=>({path:typeof input==='string'?input:input?.path})):inputs,prompt,seed,budgetUsd,maxHourlyUsd,deadlineAt,cleanupPolicy:'terminate-owned-pod-after-recovery'};
 bounded(plan);check(state.items?.some(item=>item.id===itemId),'Unknown board item');
 plan.inputs=await Promise.all(plan.inputs.map(input=>fingerprint(workspace,input.path,plan.projectId)));
 await validatePlan({workspace,plan});return plan;
}
export async function validatePlan({workspace,plan}){
 bounded(plan);const state=await board(workspace);
 check(state.revision===plan.boardRevision,'Board revision changed; create a new plan');
 check(state.project?.id===plan.projectId&&state.items?.some(item=>item.id===plan.itemId),'Project or board item changed');
 for(const input of plan.inputs){const actual=await fingerprint(workspace,input.path,plan.projectId);check(actual.sha256===input.sha256&&actual.sizeBytes===input.sizeBytes,'Input material changed; create a new plan');}
 return true;
}
