import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const CODES = new Set(['usage_error', 'not_found', 'bad_request', 'unauthorized', 'forbidden', 'conflict', 'rate_limited', 'server_error', 'api_error', 'graphql_error', 'no_credentials', 'network_error', 'cli_error', 'timeout', 'wait_timeout', 'wait_interrupted']);
const DEFINITIVE = new Set(['usage_error', 'bad_request', 'unauthorized', 'forbidden', 'no_credentials', 'not_found', 'conflict', 'rate_limited']);

export class ProviderError extends Error {
  constructor(code, id) {
    super(`Runpod provider: ${code}`);
    this.name = 'ProviderError';
    this.code = code;
    if (typeof id === 'string' && ID.test(id)) this.id = id;
  }
}
function requireId(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new ProviderError('invalid_input');
  return id;
}
function ownedName(runId) {
  if (typeof runId !== 'string' || !UUID.test(runId)) throw new ProviderError('invalid_input');
  return `production-board-${runId.toLowerCase()}`;
}
function parse(raw) {
  try { return JSON.parse(raw); } catch { throw new ProviderError('invalid_response'); }
}
function pod(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !ID.test(value.id) || typeof value.name !== 'string') throw new ProviderError('invalid_response');
  const result = { id: value.id, name: value.name };
  if (['RUNNING', 'EXITED', 'TERMINATED', 'STOPPED'].includes(value.desiredStatus)) result.desiredStatus = value.desiredStatus;
  if (['running', 'initializing', 'stopped', 'terminated', 'unknown'].includes(value.runtimeStatus)) result.runtimeStatus = value.runtimeStatus;
  if (Number.isFinite(value.costPerHr) && value.costPerHr >= 0) result.costPerHr = value.costPerHr;
  return result;
}

// The injected execFile uses the promisified Node contract; no shell is involved.
export function createProvider({ binary, execFile = promisify(nodeExecFile) }) {
  if (typeof binary !== 'string' || !binary) throw new ProviderError('invalid_input');
  async function invoke(args, mutation = false, json = true) {
    let result;
    try {
      result = await execFile(binary, args, { timeout: 45000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', shell: false });
    } catch (error) {
      let payload;
      try { payload = JSON.parse(error.stderr); } catch { /* Never expose subprocess output. */ }
      const code = CODES.has(payload?.code) ? payload.code : error.code === 'ENOENT' ? 'binary_missing' : 'provider_error';
      const unknown = mutation && (payload?.id || (!DEFINITIVE.has(code) && code !== 'binary_missing'));
      throw new ProviderError(unknown ? 'outcome_unknown' : code, payload?.id);
    }
    if (!json) return result.stdout;
    try {
      const data = parse(result.stdout);
      if (data && typeof data === 'object' && !Array.isArray(data) && 'error' in data) throw new ProviderError('invalid_response');
      return data;
    } catch {
      throw new ProviderError(mutation ? 'outcome_unknown' : 'invalid_response');
    }
  }
  async function listPods() {
    const data = await invoke(['pod', 'list', '--all', '--output=json']);
    if (!Array.isArray(data)) throw new ProviderError('invalid_response');
    return data.map(pod);
  }
  async function inspect(id) {
    requireId(id);
    try { return pod(await invoke(['pod', 'get', id, '--output=json'])); }
    catch (error) { if (error.code === 'not_found') return null; throw error; }
  }
  async function listOwned(runId) {
    const name = ownedName(runId);
    return (await listPods()).filter(item => item.name === name);
  }
  async function create(plan) {
    const name = ownedName(plan?.runId);
    const p = plan.provision;
    if (plan.executionAuthorized !== true || !p || typeof p.gpuId !== 'string' || !p.gpuId.trim() || p.gpuId.length > 200 || /[\r\n\0]/.test(p.gpuId) || typeof p.image !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9./:@_-]{0,999}$/.test(p.image) || !Number.isSafeInteger(p.containerDiskInGb) || p.containerDiskInGb < 1 || p.containerDiskInGb > 100000 || !Number.isSafeInteger(p.volumeInGb) || p.volumeInGb < 0 || p.volumeInGb > 100000) throw new ProviderError('invalid_input');
    const data = await invoke(['pod', 'create', '--name', name, '--gpu-id', p.gpuId, '--image', p.image, '--gpu-count', '1', '--container-disk-in-gb', String(p.containerDiskInGb), '--volume-in-gb', String(p.volumeInGb), '--output=json'], true);
    try { return pod(data); } catch { throw new ProviderError('outcome_unknown', data?.id); }
  }
  async function terminate(id) {
    requireId(id);
    // An accepted deletion still needs inspect(id) === null before reporting cleanup.
    await invoke(['pod', 'delete', id, '--output=json'], true);
    return { id, acknowledged: true };
  }
  async function diagnostics() {
    let version = null;
    try {
      const raw = await invoke(['version'], false, false);
      version = raw.match(/\bv?\d+\.\d+\.\d+\b/)?.[0] ?? null;
      if (!version) throw new ProviderError('invalid_response');
      const pods = await listPods();
      return { binary, version, authenticated: true, podCount: pods.length };
    } catch (error) {
      return { binary, version, authenticated: false, error: { code: error instanceof ProviderError ? error.code : 'provider_error' } };
    }
  }
  return { diagnostics, listPods, inspect, listOwned, create, terminate };
}
