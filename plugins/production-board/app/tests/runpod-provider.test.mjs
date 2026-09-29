import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../lib/runpod/provider.mjs';

const runId = '8f2118b4-17bc-480d-a7ea-ae10e729a40b';
const name = `production-board-${runId}`;
const plan = { runId, executionAuthorized: true, provision: { gpuId: 'NVIDIA RTX 4090', image: 'runpod/pytorch:1.0', containerDiskInGb: 30, volumeInGb: 0 } };
function harness(replies) {
  const calls = [];
  const provider = createProvider({ binary: '/local/runpodctl', execFile: async (binary, args, options) => {
    calls.push({ binary, args, options });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return { stdout: typeof reply === 'string' ? reply : JSON.stringify(reply), stderr: '' };
  } });
  return { provider, calls };
}
function failure(code, extra = {}) { return Object.assign(new Error('secret-key'), { stderr: JSON.stringify({ code, error: 'secret-key', ...extra }), stdout: 'secret-key' }); }

test('diagnostics authenticates with all Pods and strips sensitive pod fields', async () => {
  const { provider, calls } = harness(['runpodctl version v2.14.0', []]);
  assert.deepEqual(await provider.diagnostics(), { binary: '/local/runpodctl', version: 'v2.14.0', authenticated: true, podCount: 0 });
  assert.deepEqual(calls[1].args, ['pod', 'list', '--all', '--output=json']);
  assert.equal(calls[1].options.shell, false);
  const other = harness([[{ id: 'abc1', name, env: { secret: 'key' }, desiredStatus: 'RUNNING', costPerHr: 0.5 }]]);
  assert.deepEqual(await other.provider.listPods(), [{ id: 'abc1', name, desiredStatus: 'RUNNING', costPerHr: 0.5 }]);
});
test('inspect treats only coded not_found as absent', async () => {
  assert.equal(await harness([failure('not_found')]).provider.inspect('abc'), null);
  for (const error of [failure('unauthorized'), Object.assign(new Error('not found secret'), { stderr: '{"status":404,"error":"not found"}' })]) {
    await assert.rejects(harness([error]).provider.inspect('abc'), e => e.code !== 'not_found' && !e.message.includes('secret'));
  }
});
test('ownership matches exact name including stopped Pods', async () => {
  const { provider } = harness([[{ id: 'a', name, runtimeStatus: 'stopped' }, { id: 'b', name: name + '-other' }]]);
  assert.equal((await provider.listOwned(runId)).length, 1);
});
test('create needs explicit authorization and builds a fixed argv', async () => {
  const { provider, calls } = harness([{ id: 'newpod', name }]);
  await assert.rejects(provider.create({ ...plan, executionAuthorized: false }), { code: 'invalid_input' });
  assert.equal(calls.length, 0);
  await provider.create({ ...plan, provision: { ...plan.provision, env: { SECRET: 'do-not-pass' }, gpuCount: 8 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[calls[0].args.indexOf('--gpu-count') + 1], '1');
  assert.ok(!calls[0].args.includes('--env'));
  await assert.rejects(provider.terminate('--all'), { code: 'invalid_input' });
});
test('ambiguous mutation never retries and retains only safe resource id', async () => {
  for (const error of [failure('network_error'), failure('timeout', { id: 'created123' }), failure('wait_timeout', { id: 'created123' }), new Error('secret-key')]) {
    const { provider, calls } = harness([error]);
    await assert.rejects(provider.create(plan), e => e.code === 'outcome_unknown' && !JSON.stringify(e).includes('secret-key'));
    assert.equal(calls.length, 1);
  }
  await assert.rejects(harness([failure('timeout', { id: '../secret' })]).provider.terminate('abc'), e => e.code === 'outcome_unknown' && e.id === undefined);
  await assert.rejects(harness([failure('forbidden')]).provider.create(plan), { code: 'forbidden' });
});
test('bad mutation response is unknown, failed diagnostics exposes only safe code', async () => {
  await assert.rejects(harness(['not-json secret-key']).provider.create(plan), { code: 'outcome_unknown' });
  const result = await harness(['v2.14.0', failure('unauthorized')]).provider.diagnostics();
  assert.deepEqual(result.error, { code: 'unauthorized' });
  assert.equal(result.authenticated, false);
  assert.ok(!JSON.stringify(result).includes('secret-key'));
});
