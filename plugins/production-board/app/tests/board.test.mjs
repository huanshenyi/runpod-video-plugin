import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';
import { SOURCE } from '../lib/board.mjs';

async function fixture(t) {
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'production-board-test-'));
  const dir=path.dirname(path.join(workspace,SOURCE));
  await fs.mkdir(path.join(dir,'images/01-test'),{recursive:true});
  await fs.mkdir(path.join(dir,'videos/01-test'),{recursive:true});
  const source='# Scene 01 — Test\n\n| ID | 内容 | 仮尺 | 画像 | 動画 |\n| --- | --- | --- | --- | --- |\n| 01 | Morning arrival | 未定 | [画像](./images/01-test/) | [動画](./videos/01-test/) |\n\n[Story](./story.md)\n';
  await fs.writeFile(path.join(workspace,SOURCE),source);
  await fs.writeFile(path.join(dir,'story.md'),'# Story\nAn original test scene.');
  await fs.writeFile(path.join(dir,'images/01-test/start.png'),Buffer.from([137,80,78,71,13,10,26,10]));
  await fs.writeFile(path.join(dir,'videos/01-test/test.mp4'),'0123456789');
  const {server,url}=await startServer({workspace,port:0});
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(workspace,{recursive:true,force:true});});
  const request=async(route,method='GET',data,headers={})=>{
    const response=await fetch(url+route,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined});
    const body=await response.json();return {status:response.status,body};
  };
  return {workspace,dir,url,source,request};
}

test('imports undecided content units and detects their actual media',async t=>{
  const f=await fixture(t);const {body:b}=await f.request('/api/board');
  assert.equal(b.items.length,1);assert.equal(b.items[0].durationSeconds,null);
  assert.equal(b.items[0].assets.length,2);assert.equal(b.references[0].exists,true);
  assert.equal(b.project.sourceMarkdown,f.source);
  const {body:h}=await f.request('/api/health');assert.equal(h.workspace,await fs.realpath(f.workspace));
});
test('saves with revision, rejects stale writes, and restores without editing source',async t=>{
  const f=await fixture(t);const {body:b}=await f.request('/api/board');
  b.items[0].notes='服装の連続性を確認';b.items[0].durationSeconds=6;
  const saved=await f.request('/api/board','PUT',{revision:b.revision,items:b.items});
  assert.equal(saved.status,200);assert.equal(saved.body.revision,2);
  assert.equal((await f.request('/api/board','PUT',{revision:b.revision,items:b.items})).status,409);
  const {body:h}=await f.request('/api/history');assert.equal(h.entries.length,1);
  const restored=await f.request('/api/restore','POST',{revision:2,id:h.entries[0].id});
  assert.equal(restored.body.revision,3);assert.equal(restored.body.items[0].notes,'');
  assert.equal(restored.body.items[0].durationSeconds,null);
  assert.equal(await fs.readFile(path.join(f.workspace,SOURCE),'utf8'),f.source);
});
test('simultaneous writes accept exactly one revision and preserve the winner',async t=>{
  const f=await fixture(t);const {body:b}=await f.request('/api/board');
  const results=await Promise.all(['A','B'].map(notes=>f.request('/api/board','PUT',{revision:b.revision,items:b.items.map(i=>({...i,notes}))})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.request('/api/board')).body.items[0].notes,results.find(r=>r.status===200).body.items[0].notes);
});
test('rejects invalid fields, forged media selection, and cross-origin writes',async t=>{
  const f=await fixture(t);const {body:b}=await f.request('/api/board');
  for(const patch of [{durationSeconds:-1},{title:''},{selectedStart:'videos/other.png'}]){
    const r=await f.request('/api/board','PUT',{revision:b.revision,items:b.items.map(i=>({...i,...patch}))});assert.equal(r.status,400);
  }
  assert.equal((await f.request('/api/board','PUT',{revision:b.revision,items:b.items},{Origin:'https://evil.example'})).status,403);
});
test('workspace media rejects traversal and escaping symlinks, serves video ranges',async t=>{
  const f=await fixture(t);
  assert.equal((await fetch(f.url+'/api/file?path='+encodeURIComponent('../../etc/passwd'))).status,403);
  await fs.symlink('/etc/passwd',path.join(f.dir,'images/01-test/leak.png'));
  const rel=path.posix.dirname(SOURCE)+'/images/01-test/leak.png';
  assert.equal((await fetch(f.url+'/api/file?path='+encodeURIComponent(rel))).status,403);
  const video=path.posix.dirname(SOURCE)+'/videos/01-test/test.mp4';
  const r=await fetch(f.url+'/api/file?path='+encodeURIComponent(video),{headers:{Range:'bytes=2-5'}});
  assert.equal(r.status,206);assert.equal(await r.text(),'2345');
  assert.equal((await fetch(f.url+'/api/file?path='+encodeURIComponent(video),{headers:{Range:'bytes=100-'}})).status,416);
});
test('README folder links can list a project folder without exposing other files',async t=>{
  const f=await fixture(t);const rel=path.posix.dirname(SOURCE)+'/images/01-test/';
  const r=await f.request('/api/directory?path='+encodeURIComponent(rel));
  assert.equal(r.status,200);assert.equal(r.body.entries[0].name,'start.png');
  assert.equal((await f.request('/api/directory?path='+encodeURIComponent('board/'))).status,403);
});
