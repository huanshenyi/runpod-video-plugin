import { mkdir, open, rename, readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const definitive = new Set(['invalid_input', 'bad_request', 'unauthorized', 'forbidden', 'no_credentials', 'binary_missing', 'usage_error', 'not_found', 'conflict', 'rate_limited']);
function fail(code, status = 400) { throw Object.assign(new Error(code), { code, status }); }
function publicState(s) { return { runId: s.runId, status: s.status, pod: s.pod, deadlineAt: s.deadlineAt }; }
function normalize(input) {
  const p = input?.plan;
  const v = p?.provision;
  if (!UUID.test(input?.runId ?? '') || p?.runId !== input.runId || p.executionAuthorized !== true || !v) fail('invalid_plan');
  if (Object.keys(v).some(k => !['gpuId', 'image', 'containerDiskInGb', 'volumeInGb', 'publicKey', 'countryCode', 'dataCenterIds'].includes(k))) fail('unsupported_provision');
  if (typeof v.gpuId !== 'string' || typeof v.image !== 'string' || !Number.isSafeInteger(v.containerDiskInGb) || v.containerDiskInGb < 1 || !Number.isSafeInteger(v.volumeInGb) || v.volumeInGb < 0) fail('invalid_provision');
  if (![p.maxHourlyUsd, p.budgetUsd].every(n => Number.isFinite(n) && n > 0)) fail('invalid_budget');
  const deadline = Date.parse(input.deadlineAt);
  if (!Number.isFinite(deadline)) fail('invalid_deadline');
  return { runId: input.runId, deadlineAt: new Date(deadline).toISOString(), plan: { runId: p.runId, executionAuthorized: true, maxHourlyUsd: p.maxHourlyUsd, budgetUsd: p.budgetUsd, provision: { gpuId: v.gpuId, image: v.image, containerDiskInGb: v.containerDiskInGb, volumeInGb: v.volumeInGb, ...(v.publicKey !== undefined ? { publicKey: v.publicKey } : {}), ...(v.countryCode !== undefined ? { countryCode: v.countryCode } : {}), ...(v.dataCenterIds !== undefined ? { dataCenterIds: v.dataCenterIds } : {}) }, ...(p.storageHourlyUsd !== undefined ? { storageHourlyUsd: p.storageHourlyUsd } : {}) } };
}
// One controller process owns a state directory. Requests and sweep share one lock.
export async function createDeadlineController({ directory, provider, token, now = () => Date.now(), sweepMs = 10000 }) {
  if (typeof token !== 'string' || token.length < 32) fail('controller_token_required');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, '.owner.lock');
  const owner = { pid: process.pid, host: hostname() };
  let lock;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { lock = await open(lockPath, 'wx', 0o600); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let previous;
      try { previous = JSON.parse(await readFile(lockPath, 'utf8')); } catch { fail('controller_locked', 409); }
      if (previous.host !== owner.host || !Number.isSafeInteger(previous.pid) || previous.pid <= 0) fail('controller_locked', 409);
      try { process.kill(previous.pid, 0); fail('controller_locked', 409); }
      catch (check) { if (check.code !== 'ESRCH') throw check; }
      // Serialize stale-lock recovery too: competing starters cannot unlink a new owner's lock.
      const recoveryPath = `${lockPath}.recovery`;
      let recovery;
      try { recovery = await open(recoveryPath, 'wx', 0o600); } catch { fail('controller_locked', 409); }
      try {
        const current = JSON.parse(await readFile(lockPath, 'utf8'));
        if (current.pid !== previous.pid || current.host !== previous.host) fail('controller_locked', 409);
        await unlink(lockPath);
      } finally { await recovery.close(); await unlink(recoveryPath); }
    }
  }
  if (!lock) fail('controller_locked', 409);
  await lock.writeFile(JSON.stringify(owner)); await lock.sync();
  let closed = false;
  async function release() { if (!closed) { closed = true; await lock.close(); await unlink(lockPath); } }
  let queue = Promise.resolve();
  const serialized = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  const filename = id => { if (!UUID.test(id)) fail('invalid_run_id'); return path.join(directory, `${id}.json`); };
  async function load(id) { try { return JSON.parse(await readFile(filename(id), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  async function save(state) {
    const file = filename(state.runId);
    const tmp = `${file}.tmp`;
    const handle = await open(tmp, 'w', 0o600);
    try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); } finally { await handle.close(); }
    await rename(tmp, file);
    const dir = await open(directory, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  }
  async function cleanup(state) {
    if (state.status === 'deleted' || (state.status === 'failed' && !state.pod)) return state;
    // An uncertain create is never retried or adopted by name alone.
    if (!state.pod) return state;
    state.status = 'cleanup_pending';
    await save(state);
    try {
      if (await provider.inspect(state.pod.id)) await provider.terminate(state.pod.id);
    } catch { /* A deletion response may be lost; reconcile below. */ }
    try {
      if (await provider.inspect(state.pod.id) === null) { state.status = 'deleted'; state.deletedAt = new Date(now()).toISOString(); }
    } catch { /* Preserve cleanup_pending for the next sweep. */ }
    await save(state);
    return state;
  }
  async function create(input) {
    const n = normalize(input);
    const fingerprint = createHash('sha256').update(JSON.stringify(n)).digest('hex');
    const old = await load(n.runId);
    if (old) { if (old.fingerprint !== fingerprint) fail('run_conflict', 409); return publicState(old); }
    const hours = (Date.parse(n.deadlineAt) - now()) / 3600000;
    // Conservative storage envelope and 10% budget reserve, not a billing guarantee.
    if (n.plan.storageHourlyUsd !== undefined && (!Number.isFinite(n.plan.storageHourlyUsd) || n.plan.storageHourlyUsd < 0)) fail('invalid_storage_rate');
    const storageHourly = Math.max(n.plan.storageHourlyUsd ?? 0, (n.plan.provision.containerDiskInGb + n.plan.provision.volumeInGb) * 0.0003);
    if (hours <= 0 || hours > 24 || hours * (n.plan.maxHourlyUsd + storageHourly) > n.plan.budgetUsd * 0.9) fail('deadline_exceeds_budget');
    const state = { ...n, fingerprint, status: 'create_pending', pod: null, createdAt: new Date(now()).toISOString() };
    await save(state); // Durable intent BEFORE the first billable call.
    try {
      const pod = await provider.create(n.plan);
      if (!ID.test(pod?.id ?? '')) fail('invalid_provider_response');
      state.pod = { id: pod.id, name: typeof pod.name === 'string' ? pod.name : `production-board-${n.runId}` };
      if (Number.isFinite(pod.costPerHr)) state.pod.costPerHr = pod.costPerHr;
      state.status = 'active';
      await save(state);
      if (!Number.isFinite(pod.costPerHr) || pod.costPerHr > n.plan.maxHourlyUsd || now() >= Date.parse(n.deadlineAt)) await cleanup(state);
    } catch (e) {
      if (ID.test(e.id ?? '')) state.pod = { id: e.id, name: `production-board-${n.runId}` };
      state.status = definitive.has(e.code) && !state.pod ? 'failed' : state.pod ? 'cleanup_pending' : 'create_pending';
      await save(state);
      if (state.pod) await cleanup(state);
    }
    return publicState(state);
  }
  async function get(id) {
    const s = await load(id); if (!s) fail('not_found', 404);
    if (s.status === 'active' && s.pod) {
      let actual;
      try { actual = await provider.inspect(s.pod.id); } catch { fail('provider_unavailable', 503); }
      if (actual === null) { s.status = 'deleted'; s.deletedAt = new Date(now()).toISOString(); await save(s); }
      else {
        if (actual.id !== s.pod.id || !Number.isFinite(actual.costPerHr)) fail('provider_unavailable', 503);
        s.pod.costPerHr = actual.costPerHr; await save(s);
        if (actual.costPerHr > s.plan.maxHourlyUsd || now() >= Date.parse(s.deadlineAt)) await cleanup(s);
      }
    }
    return publicState(s);
  }
  async function remove(id) { const s = await load(id); if (!s) fail('not_found', 404); return publicState(await cleanup(s)); }
  async function sweep() {
    for (const file of await readdir(directory)) {
      if (!file.endsWith('.json')) continue;
      const s = await load(file.slice(0, -5));
      if (s && (s.status === 'cleanup_pending' || now() >= Date.parse(s.deadlineAt))) await cleanup(s);
    }
  }
  const api = { create: input => serialized(() => create(input)), get: id => serialized(() => get(id)), remove: id => serialized(() => remove(id)), sweep: () => serialized(sweep) };
  try { await api.sweep(); } catch (e) { await release(); throw e; }
  const timer = sweepMs > 0 ? setInterval(() => { api.sweep().catch(() => {}); }, sweepMs) : null;
  timer?.unref();
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const got = Buffer.from(req.headers.authorization ?? '');
      const want = Buffer.from(`Bearer ${token}`);
      if (got.length !== want.length || !timingSafeEqual(got, want)) fail('unauthorized', 401);
      let result;
      if (req.method === 'GET' && req.url === '/health') result = { ready: true, now: new Date(now()).toISOString(), service: 'runpod-deadline-controller' };
      else if (req.method === 'POST' && req.url === '/runs') {
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 16384) fail('body_too_large', 413); }
        let data; try { data = JSON.parse(body); } catch { fail('invalid_json'); }
        result = await api.create(data);
      } else {
        const match = req.url?.match(/^\/runs\/([a-f0-9-]+)$/);
        if (!match) fail('not_found', 404);
        if (req.method === 'GET') result = await api.get(match[1]);
        else if (req.method === 'DELETE') result = await api.remove(match[1]);
        else fail('method_not_allowed', 405);
      }
      res.end(JSON.stringify(result));
    } catch (e) { res.statusCode = e.status ?? 500; res.end(JSON.stringify({ error: e.status ? e.code : 'controller_error' })); }
  });
  return { ...api, server, close: async () => { clearInterval(timer); await queue; if (server.listening) await new Promise(resolve => server.close(resolve)); await release(); } };
}
