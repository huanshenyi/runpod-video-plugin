import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createStore,SOURCE} from '../lib/board.mjs';
const cli=fileURLToPath(new URL('../../scripts/board.mjs',import.meta.url));
test('fresh workspace imports two generic cards and init preserves source',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'board-init-'));
 try{
  execFileSync(process.execPath,[cli,'init','--workspace',dir]);
  const store=await createStore(dir),state=await store.read();
  assert.equal(state.items.length,2);assert.equal(state.project.id,'scene-01');
  assert.equal(state.project.sourcePath,SOURCE);
  const source=path.join(dir,SOURCE);await writeFile(source,(await readFile(source,'utf8'))+'\nUser edit\n');
  try{execFileSync(process.execPath,[cli,'init','--workspace',dir],{stdio:'pipe'});}catch(e){assert.equal(e.status,1);}
  assert.match(await readFile(source,'utf8'),/User edit/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('configured source imports and saved source wins on reopening',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'board-config-'));
 try{
  await mkdir(path.join(dir,'videos','film'),{recursive:true});await mkdir(path.join(dir,'board'));
  await writeFile(path.join(dir,'videos/film/README.md'),'# Custom\n| 01 | Card | TBD | [画像](./images/) | [動画](./videos/) |\n');
  await writeFile(path.join(dir,'board/config.json'),JSON.stringify({sourcePath:'videos/film/README.md',project:{title:'Custom Film'}}));
  const state=await(await createStore(dir)).read();assert.equal(state.project.id,'film');assert.equal(state.project.title,'Custom Film');
  await writeFile(path.join(dir,'board/config.json'),JSON.stringify({sourcePath:'../../private.md'}));
  assert.equal((await(await createStore(dir)).read()).project.sourcePath,'videos/film/README.md');
 }finally{await rm(dir,{recursive:true,force:true});}
});
