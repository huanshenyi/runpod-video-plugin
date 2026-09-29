import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDeadlineController } from '../lib/runpod/deadline-controller.mjs';

const runId = 'a0b0c0d0-1111-4111-8111-111111111111';
const token = 'a'.repeat(40);
async function fixture(t, override = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'deadline-test-'));
  let clock = Date.parse('2026-09-29T00:00:00Z');
  let pod = null, creates = 0, deletes = 0;
  const provider = { create: async () => { creates++; return pod = { id: 'pod1', name: `production-board-${runId}`, costPerHr: 2 }; }, inspect: async () => pod, terminate: async () => { deletes++; pod = null; }, ...override };
  const options = { directory, provider, token, now: () => clock, sweepMs: 0 };
  const c = await createDeadlineController(options);
  t.after(async () => { await c.close(); await rm(directory, { recursive: true, force: true }); });
  const input = { runId, deadlineAt: '2026-09-29T01:00:00Z', plan: { runId, executionAuthorized: true, maxHourlyUsd: 2.1, budgetUsd: 5, provision: { gpuId: 'test', image: 'test/image', containerDiskInGb: 20, volumeInGb: 10 } } };
  return { c, options, input, directory, advance: () => { clock += 3600001; }, counts: () => ({ creates, deletes }) };
}
test('concurrent duplicate create, deletion, and tombstone never recreate', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.c.create(f.input), f.c.create(f.input)]);
  assert.equal(results[0].status, 'active');
  assert.equal(f.counts().creates, 1);
  await f.c.remove(runId); await f.c.remove(runId);
  assert.equal((await f.c.create(f.input)).status, 'deleted');
  assert.deepEqual(f.counts(), { creates: 1, deletes: 1 });
});
test('intent is durable before create and ambiguous result never resubmits', async t => {
  const f = await fixture(t);
  f.options.provider.create = async () => {
    assert.equal(JSON.parse(await readFile(path.join(f.directory, `${runId}.json`))).status, 'create_pending');
    throw Object.assign(new Error('network'), { code: 'outcome_unknown' });
  };
  assert.equal((await f.c.create(f.input)).status, 'create_pending');
  f.options.provider.create = async () => { throw new Error('must not retry'); };
  assert.equal((await f.c.create(f.input)).status, 'create_pending');
});
test('restart sweeps persisted deadlines', async t => {
  const f = await fixture(t); await f.c.create(f.input); await f.c.close(); f.advance();
  const restarted = await createDeadlineController(f.options);
  assert.equal((await restarted.get(runId)).status, 'deleted');
  await restarted.close();
});
test('failed delete remains pending until absence verified', async t => {
  const f = await fixture(t); await f.c.create(f.input);
  const terminate = f.options.provider.terminate;
  f.options.provider.terminate = async () => { throw new Error('offline'); };
  assert.equal((await f.c.remove(runId)).status, 'cleanup_pending');
  f.options.provider.terminate = terminate; await f.c.sweep();
  assert.equal((await f.c.get(runId)).status, 'deleted');
});
test('rejects overspend, network volume, changed replay; credentials not persisted', async t => {
  const f = await fixture(t);
  await assert.rejects(f.c.create({ ...f.input, deadlineAt: '2026-09-30T00:00:00Z' }), /deadline_exceeds_budget/);
  await assert.rejects(f.c.create({ ...f.input, plan: { ...f.input.plan, provision: { ...f.input.plan.provision, networkVolumeId: 'foreign' } } }), /unsupported_provision/);
  await f.c.create(f.input);
  await assert.rejects(f.c.create({ ...f.input, deadlineAt: '2026-09-29T00:30:00Z' }), /run_conflict/);
  assert.equal((await readFile(path.join(f.directory, `${runId}.json`), 'utf8')).includes(token), false);
});
test('authenticated API rejects missing token', async t => {
  const f = await fixture(t);
  await new Promise(resolve => f.c.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${f.c.server.address().port}`;
  assert.equal((await fetch(`${url}/health`)).status, 401);
  const result = await fetch(`${url}/health`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal((await result.json()).ready, true);
});
test('explicit ambiguous error ID is cleaned without adopting other pods', async t => {
  let inspected = [], deleted = false;
  const f = await fixture(t, {
    create: async () => { throw Object.assign(new Error('lost response'), { code: 'outcome_unknown', id: 'owned-id' }); },
    inspect: async id => { inspected.push(id); return deleted ? null : { id }; },
    terminate: async id => { assert.equal(id, 'owned-id'); deleted = true; },
  });
  assert.equal((await f.c.create(f.input)).status, 'deleted');
  assert.deepEqual(inspected, ['owned-id', 'owned-id']);
});
test('unknown creation stays pending after deadline; unproven ownership is not deleted', async t => {
  const f = await fixture(t, { create: async () => { throw Object.assign(new Error('timeout'), { code: 'outcome_unknown' }); } });
  await f.c.create(f.input); f.advance(); await f.c.sweep();
  assert.equal((await f.c.get(runId)).status, 'create_pending');
  assert.equal(f.counts().deletes, 0);
});
test('second controller cannot share live owner directory', async t => {
  const f = await fixture(t);
  await assert.rejects(createDeadlineController(f.options), /controller_locked/);
  await f.c.close();
  const next = await createDeadlineController(f.options);
  await next.close();
});
test('dead same-host owner can recover; foreign host cannot', async t => {
  const { writeFile } = await import('node:fs/promises');
  const { hostname } = await import('node:os');
  const f = await fixture(t); await f.c.close();
  const lock = path.join(f.directory, '.owner.lock');
  await writeFile(lock, JSON.stringify({ host: `${hostname()}-other`, pid: 2147483647 }));
  await assert.rejects(createDeadlineController(f.options), /controller_locked/);
  await writeFile(lock, JSON.stringify({ host: hostname(), pid: 2147483647 }));
  const next = await createDeadlineController(f.options); await next.close();
});
test('GET reconciles disappearance and fails closed on inspection failure', async t => {
  const f = await fixture(t); await f.c.create(f.input);
  f.options.provider.inspect = async () => { throw new Error('offline'); };
  await assert.rejects(f.c.get(runId), /provider_unavailable/);
  f.options.provider.inspect = async () => null;
  assert.equal((await f.c.get(runId)).status, 'deleted');
});
