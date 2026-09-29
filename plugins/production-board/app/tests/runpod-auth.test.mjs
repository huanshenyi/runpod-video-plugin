import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadRunpodKey} from '../lib/runpod/auth.mjs';
test('MCP uses the same environment override or CLI config key',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'runpod-auth-'));
 try{
  const configPath=path.join(dir,'config.toml');
  await writeFile(configPath,'apikey = "test-config-key"\napiurl = "https://api.runpod.io/graphql"\n');
  assert.equal(await loadRunpodKey({env:{},configPath}),'test-config-key');
  assert.equal(await loadRunpodKey({env:{RUNPOD_API_KEY:'test-env-key'},configPath}),'test-env-key');
  await writeFile(configPath,'apikey = "secret-content-not-closed');
  await assert.rejects(loadRunpodKey({env:{},configPath}),e=>e.message==='Runpod CLI configuration is invalid. Run runpodctl doctor.');
  await writeFile(configPath,'apikey = ""');
  await assert.rejects(loadRunpodKey({env:{},configPath}),/No Runpod API key/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
