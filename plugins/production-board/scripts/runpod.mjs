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
Cloud execution is not enabled until a verified model runner, budget and recovery path are configured.
CLI selection: RUNPODCTL_BIN or runpodctl on PATH.
Use runpodctl doctor once; the optional local MCP wrapper shares its key.
`;
try {
 if(command==='help') {console.log(usage);}
 else {
  if(['run','resume','cleanup'].includes(command))throw new Error('Cloud execution is not enabled: model runner and recovery path are not configured.');
  if(!['diagnose','plan','record','status','report'].includes(command))throw new Error('Unknown command. Use help.');
  const options={};
  for(let i=0;i<args.length;i+=2){
   if(!['--workspace','--request','--plan','--id'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||options[args[i].slice(2)]!==undefined)throw new Error('Invalid or duplicate option. Use help.');
   options[args[i].slice(2)]=args[i+1];
  }
  if(!options.workspace)throw new Error('--workspace is required');
  const workspace=await fs.realpath(options.workspace);
  const store=createRunStore(workspace);
  if(command==='diagnose'){
   const {createProvider}=await import('../app/lib/runpod/provider.mjs');
   const result=await createProvider({binary:process.env.RUNPODCTL_BIN || 'runpodctl'}).diagnostics();
   console.log(JSON.stringify(result,null,2));if(!result.authenticated)process.exitCode=1;
  }else if(command==='plan'){
   if(!options.request)throw new Error('--request is required');
   const request=JSON.parse(await fs.readFile(options.request,'utf8'));
   // Explicit field selection prevents request files from changing workspace or provisioning.
   const {itemId,prompt,inputs,modelProfile,budgetUsd,maxHourlyUsd,deadlineAt,seed,operation}=request;
   console.log(JSON.stringify(await createPlan({workspace,itemId,prompt,inputs,modelProfile,budgetUsd,maxHourlyUsd,deadlineAt,seed,operation}),null,2));
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
