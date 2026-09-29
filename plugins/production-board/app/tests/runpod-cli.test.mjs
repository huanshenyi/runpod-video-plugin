import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../../scripts/runpod.mjs',import.meta.url));
test('CLI help explains preparation and does not provision',()=>{
 const output=execFileSync(process.execPath,[cli,'help'],{encoding:'utf8'});
 assert.match(output,/plan/);assert.match(output,/diagnose/);assert.match(output,/Default mode is simulate/i);
});
test('CLI requires an explicit workspace before execution',()=>{
 assert.throws(()=>execFileSync(process.execPath,[cli,'run'],{encoding:'utf8',stdio:'pipe'}),error=>error.status===1&&/workspace is required/i.test(error.stderr));
});
