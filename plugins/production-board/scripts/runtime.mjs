import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const skip=new Set(['node_modules','dist','.git','__pycache__']);
export function dataRoot(env=process.env){
 if(env.PRODUCTION_BOARD_DATA_DIR)return path.resolve(env.PRODUCTION_BOARD_DATA_DIR);
 if(process.platform==='win32')return path.join(env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'production-board');
 return path.join(env.XDG_DATA_HOME||path.join(os.homedir(),'.local','share'),'production-board');
}
export async function command(program,args,cwd){
 await new Promise((resolve,reject)=>{
  const child=spawn(program,args,{cwd,stdio:['inherit',process.stderr,process.stderr],shell:process.platform==='win32'&&program==='npm.cmd'});
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${program} failed (${code})`)));
 });
}
export async function prepareRuntime({plugin,root=dataRoot(),run=command}){
 const files=[];
 async function collect(dir=''){
  for(const name of (await fs.readdir(path.join(plugin,dir))).sort()){
   if(skip.has(name))continue;
   const rel=path.join(dir,name),stat=await fs.lstat(path.join(plugin,rel));
   if(stat.isSymbolicLink())throw new Error('Plugin source must not contain symlinks');
   if(stat.isDirectory())await collect(rel);else if(stat.isFile())files.push(rel);
  }
 }
 await collect();
 const hash=createHash('sha256');for(const file of files)hash.update(file).update(await fs.readFile(path.join(plugin,file)));
 const fingerprint=hash.digest('hex');const runtime=path.join(root,'runtimes',fingerprint);
 const ready=path.join(runtime,'.ready.json');
 try{if(JSON.parse(await fs.readFile(ready,'utf8')).fingerprint===fingerprint){await fs.access(path.join(runtime,'app/dist/index.html'));return {runtime,reused:true};}}catch{}
 await fs.mkdir(path.dirname(runtime),{recursive:true});
 const lock=runtime+'.lock';
 try{await fs.mkdir(lock);}catch(e){if(e.code==='EEXIST')throw new Error('Setup already running or interrupted; inspect the runtime lock before retrying');throw e;}
 try{
  await fs.mkdir(runtime,{recursive:true});
  for(const file of files){const target=path.join(runtime,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(plugin,file),target);}
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  await run(npm,['ci','--no-audit','--no-fund'],path.join(runtime,'app'));
  await run(npm,['run','build'],path.join(runtime,'app'));
  await fs.access(path.join(runtime,'app/dist/index.html'));
  await fs.writeFile(ready,JSON.stringify({fingerprint,preparedAt:new Date().toISOString()})+'\n');
  return {runtime,reused:false};
 }finally{await fs.rmdir(lock);}
}
