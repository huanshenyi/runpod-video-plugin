import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../../scripts/runpod.mjs',import.meta.url));
test('CLI help explains preparation and does not provision',()=>{
 const output=execFileSync(process.execPath,[cli,'help'],{encoding:'utf8'});
 assert.match(output,/plan/);assert.match(output,/diagnose/);assert.match(output,/not enabled/i);
});
test('CLI refuses execution before a model runner is configured',()=>{
 assert.throws(()=>execFileSync(process.execPath,[cli,'run'],{encoding:'utf8',stdio:'pipe'}),error=>error.status===1&&/not enabled/i.test(error.stderr));
});
