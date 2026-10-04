import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateBundle, diagnose } from '../../scripts/deadline-setup.mjs';

test('bundle contains isolated persistent service, no credentials, refuses overwrite', async () => {
 const out = path.join(await mkdtemp(path.join(tmpdir(), 'deadline-setup-')), 'bundle');
 await generateBundle(out, 'deadline.example.com');
 const unit = await readFile(path.join(out, 'runpod-deadline.service'), 'utf8');
 assert.match(unit, /StateDirectory=runpod-deadline/);
 assert.match(unit, /Restart=always/);
 assert.match(unit, /User=runpod-deadline/);
 assert.match(unit, /EnvironmentFile=/);
 assert.match(await readFile(path.join(out, 'Caddyfile'), 'utf8'), /127.0.0.1:4319/);
 assert.equal((await stat(out)).mode & 0o777, 0o700);
 await assert.rejects(generateBundle(out, 'deadline.example.com'));
 await assert.rejects(generateBundle(out+'bad', 'example.com\n:80'));
});
test('diagnosis never mutates, rejects redirects and never exposes remote errors or token', async () => {
 let calls=0;
 const fetchImpl=async (url, options) => {
  calls++; assert.equal(url, 'https://deadline.example.com/health');
  assert.equal(options.redirect, 'error'); assert.equal(options.method,'GET');
  return {ok:true,json:async()=>({ready:true,service:'runpod-deadline-controller',now:new Date().toISOString()})};
 };
 assert.equal((await diagnose('https://deadline.example.com', 'x'.repeat(32),fetchImpl)).ok,true);
 assert.equal(calls,1);
 assert.equal((await diagnose('http://example.com','x'.repeat(32),fetchImpl)).ok,false);
 assert.equal(calls,1);
 const result=await diagnose('https://deadline.example.com','x'.repeat(32),async()=>{throw Error('secret');});
 assert.equal(result.ok,false); assert.ok(!JSON.stringify(result).includes('secret'));
 assert.equal((await diagnose('https://deadline.example.com','x'.repeat(32),async()=>({ok:true,json:async()=>({ready:true,service:'other'})}))).ok,false);
});
