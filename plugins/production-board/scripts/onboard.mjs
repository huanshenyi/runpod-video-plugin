#!/usr/bin/env node
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {prepareRuntime,command} from './runtime.mjs';
try{
 if(Number(process.versions.node.split('.')[0])<22)throw Error('Node.js 22 or newer is required');
 const args=process.argv.slice(2);
 if(args.length!==2||args[0]!=='--workspace'||!args[1])throw Error('Usage: node scripts/onboard.mjs --workspace ABSOLUTE_PATH');
 if(!path.isAbsolute(args[1]))throw Error('--workspace must be absolute');
 const workspace=path.resolve(args[1]);
 const plugin=fileURLToPath(new URL('../',import.meta.url));
 const setup=await prepareRuntime({plugin});
 await fs.mkdir(workspace,{recursive:true});
 const existing=await Promise.all(['board/project.json','board/config.json','videos/scene-01/README.md'].map(p=>fs.access(path.join(workspace,p)).then(()=>true,()=>false)));
 if(!existing.some(Boolean))await command(process.execPath,[path.join(setup.runtime,'scripts/board.mjs'),'init','--workspace',workspace],setup.runtime);
 const {createProvider}=await import(pathToFileURL(path.join(setup.runtime,'app/lib/runpod/provider.mjs')).href);
 const connection=await createProvider({binary:process.env.RUNPODCTL_BIN||'runpodctl'}).diagnostics();
 console.log(JSON.stringify({ready:true,...setup,workspace,runpod:connection,next:connection.authenticated?'start-board':'configure-runpod',boardScript:path.join(setup.runtime,'scripts/board.mjs'),runpodScript:path.join(setup.runtime,'scripts/runpod.mjs'),mcpConfigScript:path.join(setup.runtime,'scripts/mcp-config.mjs')},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
