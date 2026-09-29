#!/usr/bin/env node
import {readFile,readdir,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>readFile(path.join(root,p),'utf8');
const manifest=JSON.parse(await read('plugin.json'));
const legacy=JSON.parse(await read('.codex-plugin/plugin.json'));
assert.equal(manifest.name,'production-board');
assert.equal(manifest.version,legacy.version);
assert.equal(manifest.version,JSON.parse(await read('app/package.json')).version);
const ignored=new Set(['node_modules','dist','.git','__pycache__']);
let count=0;
async function walk(dir=''){
 for(const name of await readdir(path.join(root,dir))){
  if(ignored.has(name))continue;
  const rel=path.join(dir,name),stat=await lstat(path.join(root,rel));
  assert(!stat.isSymbolicLink(),`Unexpected symbolic link: ${rel}`);
  assert(!['.env','.runpod','.tools','.DS_Store'].includes(name),`Private/local file: ${rel}`);
  if(stat.isDirectory()){await walk(rel);continue;}
  assert(!/\.(pem|key|log|mp4|png|jpg|zip)$/i.test(name),`Unexpected payload: ${rel}`);
  const text=await read(rel);
  assert(!/-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/.test(text),`Private key in ${rel}`);
  assert(!/\/(?:Users|home)\/[a-zA-Z0-9._-]+\//.test(text),`Machine-specific home path in ${rel}`);
  if(name.endsWith('.md'))for(const match of text.matchAll(/\]\(([^)]+)\)/g)){
   const target=match[1];
   if(/^(?:[a-z]+:|#|<)/i.test(target)||target.endsWith('/')||target.includes('/absolute/'))continue;
   // Example scene links inside README code fences are user workspace paths.
   if(target.startsWith('./images/')||target.startsWith('./videos/'))continue;
   await lstat(path.resolve(root,dir,target.split('#')[0])).catch(()=>{throw Error(`Broken link in ${rel}: ${target}`)});
  }
  count++;
 }
}
await walk();
console.log(`Package checks passed (${count} source files). This is not a comprehensive secret audit.`);
