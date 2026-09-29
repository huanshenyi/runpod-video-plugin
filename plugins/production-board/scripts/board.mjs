#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { promises as fs, existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = resolve(plugin, 'app');
const args = process.argv.slice(2);
const command = args.shift();
function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}
async function run(program, values) {
  return new Promise((accept, reject) => {
    const child = spawn(program, values, { cwd: app, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 || signal === 'SIGINT' ? accept() : reject(new Error(`${program} exited ${code ?? signal}`)));
  });
}
try {
  if (!command || command === '--help') {
    console.log('Usage: node scripts/board.mjs prepare | init --workspace <path> | start --workspace <path> [--port 4317] | status --workspace <path> [--port 4317]\nStart stays in the foreground. Stop using Ctrl+C or the owning terminal session.');
    process.exit(0);
  }
  if (command === 'prepare') {
    if (args.length) throw new Error('prepare accepts no options');
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', [existsSync(resolve(app, 'package-lock.json')) ? 'ci' : 'install']);
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);
  } else if (command === 'init') {
    const workspaceInput = option('--workspace');
    if (!workspaceInput || args.length) throw new Error('Usage: node scripts/board.mjs init --workspace <path>');
    await fs.mkdir(resolve(workspaceInput), { recursive: true });
    const workspace = realpathSync(resolve(workspaceInput));
    // Refuse symlinks at each scaffold component, including existing directories.
    for (const relative of ['videos', 'videos/scene-01', 'videos/scene-01/images', 'videos/scene-01/videos',
      'videos/scene-01/images/01-arrival', 'videos/scene-01/images/02-discovery',
      'videos/scene-01/videos/01-arrival', 'videos/scene-01/videos/02-discovery']) {
      const directory = resolve(workspace, relative);
      try { await fs.mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Refusing unsafe scaffold directory: ${relative}`);
    }
    const source = resolve(workspace, 'videos/scene-01/README.md');
    const markdown = `# Scene 01 — A New Morning

An original sample: a courier arrives at a quiet workshop and discovers a hand-painted invitation.
Replace these cards with your own production plan. Add your own media to the linked folders.

| ID | Title | Duration | Images | Videos |
| --- | --- | --- | --- | --- |
| 01 | Arrival at the workshop | Undecided | [Images](./images/01-arrival/) | [Videos](./videos/01-arrival/) |
| 02 | Discovering the invitation | Undecided | [Images](./images/02-discovery/) | [Videos](./videos/02-discovery/) |
`;
    try { await fs.writeFile(source, markdown, { flag: 'wx' }); } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Source already exists; nothing was overwritten: ${source}`);
      throw error;
    }
    console.log(`Created original two-card sample: ${source}\nWorkspace: ${workspace}\nNext: node scripts/board.mjs start --workspace "${workspace}"`);
  } else {
    if (!['start', 'status'].includes(command)) throw new Error(`Unknown command: ${command}`);
    const workspaceInput = option('--workspace');
    const portInput = option('--port') ?? '4317';
    if (!workspaceInput) throw new Error('--workspace is required; do not use the plugin cache as your workspace');
    const workspace = realpathSync(resolve(workspaceInput));
    const port = Number(portInput);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || args.length) throw new Error('Invalid port or unrecognized arguments');
    const url = `http://127.0.0.1:${port}`;
    let response;
    try { response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) }); } catch (error) {
      if (error.cause?.code !== 'ECONNREFUSED') throw new Error(`Unable to verify ${url}; refusing to start over an unknown service: ${error.message}`);
    }
    if (response) {
      const health = await response.json().catch(() => null);
      if (!response.ok || health?.service !== 'production-board' || health.workspace !== workspace) throw new Error(`Port ${port} belongs to another service or workspace. Choose another --port.`);
      console.log(`Production Board already running: ${url}\nWorkspace: ${workspace}`);
    } else if (command === 'status') {
      console.log(`Production Board is not running at ${url}`);
      process.exitCode = 1;
    } else {
      if (!existsSync(resolve(app, 'dist/index.html'))) throw new Error('Build missing. Run: node scripts/board.mjs prepare');
      console.log(`Starting Production Board: ${url}\nWorkspace: ${workspace}\nStop: Ctrl+C in this terminal.`);
      await run(process.execPath, [resolve(app, 'server.mjs'), '--workspace', workspace, '--port', String(port)]);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
