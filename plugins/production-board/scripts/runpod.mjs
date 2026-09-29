#!/usr/bin/env node
import {promises as fs} from 'node:fs';
import {createPlan,validatePlan} from '../app/lib/runpod/plan.mjs';
import {createRunStore} from '../app/lib/runpod/runs.mjs';
import {renderReport} from '../app/lib/runpod/report.mjs';

const [command='help',...args]=process.argv.slice(2);
const usage=`Production Board — Runpod preparation
  diagnose --workspace PATH       CLI authentication check (read only)
  plan --workspace PATH --request FILE   Validate request and print plan; no cloud changes
  record --workspace PATH --plan FILE    Revalidate and save a local planned run
  status --workspace PATH [--id UUID]    Read local runs
  report --workspace PATH --id UUID     Print local report
  run/resume --workspace PATH --id UUID [--mode simulate|live] [--steps N]
  cleanup --workspace PATH --id UUID [--mode simulate|live] [--discard true]
  unlock --workspace PATH --id UUID  Recover a lock only if its same-host owner is dead
Default mode is simulate: no GPU, no media generation. Live requires --authorize true,
executionConfig, H3 Python dependencies, and an independent HTTPS deadline controller.
Controller: RUNPOD_DEADLINE_URL and RUNPOD_DEADLINE_TOKEN (environment only).
CLI selection: RUNPODCTL_BIN or runpodctl on PATH.
Use runpodctl doctor once; the optional local MCP wrapper shares its key.
`;
try {
 if(command==='help') {console.log(usage);}
 else {
  if(!['diagnose','plan','record','status','report','run','resume','cleanup','unlock'].includes(command))throw new Error('Unknown command. Use help.');
  const options={};
  for(let i=0;i<args.length;i+=2){
   if(!['--workspace','--request','--plan','--id','--mode','--steps','--discard','--authorize'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||options[args[i].slice(2)]!==undefined)throw new Error('Invalid or duplicate option. Use help.');
   options[args[i].slice(2)]=args[i+1];
  }
  if(!options.workspace)throw new Error('--workspace is required');
  const workspace=await fs.realpath(options.workspace);
  const store=createRunStore(workspace);
  if(['run','resume','cleanup','unlock'].includes(command)){
   if(!options.id)throw new Error('--id is required');
   if(command==='unlock'){console.log(JSON.stringify(await store.recoverLock(options.id)));}
   else{
    const mode=options.mode||'simulate';if(!['simulate','live'].includes(mode))throw new Error('Invalid mode');
    if(options.discard!==undefined&&options.discard!=='true')throw new Error('--discard must be true');
    if(options.steps!==undefined&&(!/^[1-9][0-9]*$/.test(options.steps)||Number(options.steps)>1000))throw new Error('--steps must be 1..1000');
    if(mode==='live'&&options.authorize!=='true')throw new Error('Live execution requires --authorize true and a configured independent deadline controller');
    const {createLifecycle}=await import('../app/lib/runpod/lifecycle.mjs');
    const {createSimulator,createControllerProvider,createH3Driver}=await import('../app/lib/runpod/execution-adapters.mjs');
    const adapters=mode==='simulate'?createSimulator(workspace):{provider:createControllerProvider({url:process.env.RUNPOD_DEADLINE_URL,token:process.env.RUNPOD_DEADLINE_TOKEN}),driver:createH3Driver({workspace,python:process.env.PRODUCTION_BOARD_PYTHON||'python3',binary:process.env.RUNPODCTL_BIN||'runpodctl'})};
    const engine=createLifecycle({store,workspace,...adapters,validate:plan=>validatePlan({workspace,plan})});
    const result=await engine.execute(options.id,{command,mode,steps:options.steps?Number(options.steps):Infinity,discard:options.discard==='true'});
    console.log(JSON.stringify(result,null,2));if(result.error||['failed','reconciliation_required','cleanup_pending'].includes(result.status))process.exitCode=1;
   }
  }else if(command==='diagnose'){
   const {createProvider}=await import('../app/lib/runpod/provider.mjs');
   const result=await createProvider({binary:process.env.RUNPODCTL_BIN || 'runpodctl'}).diagnostics();
   console.log(JSON.stringify(result,null,2));if(!result.authenticated)process.exitCode=1;
  }else if(command==='plan'){
   if(!options.request)throw new Error('--request is required');
   const request=JSON.parse(await fs.readFile(options.request,'utf8'));
   // Explicit field selection prevents request files from changing workspace or provisioning.
   const {itemId,prompt,inputs,modelProfile,budgetUsd,maxHourlyUsd,deadlineAt,seed,operation,executionConfig}=request;
   console.log(JSON.stringify(await createPlan({workspace,itemId,prompt,inputs,modelProfile,budgetUsd,maxHourlyUsd,deadlineAt,seed,operation,executionConfig}),null,2));
  }else if(command==='record'){
   if(!options.plan)throw new Error('--plan is required');
   const plan=JSON.parse(await fs.readFile(options.plan,'utf8'));
   await validatePlan({workspace,plan});console.log(JSON.stringify(await store.create(plan),null,2));
  }else if(command==='report'){
   if(!options.id)throw new Error('--id is required');console.log(renderReport(await store.load(options.id)));
  }else console.log(JSON.stringify(options.id?await store.load(options.id):await store.list(),null,2));
 }
}catch(error){
 // Never print subprocess output, request contents or credential values.
 const message=error?.code==='ENOENT'?'Required file or directory is missing':error instanceof SyntaxError?'Invalid JSON input':error.message;
 console.error(message);process.exitCode=1;
}
