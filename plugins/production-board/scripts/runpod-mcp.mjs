#!/usr/bin/env node
// Share runpodctl's credential source without copying secrets into Codex config.
import {loadRunpodKey} from '../app/lib/runpod/auth.mjs';
try {
 process.env.RUNPOD_API_KEY=await loadRunpodKey();
 await import('../app/node_modules/@runpod/mcp-server/dist/stdio.mjs');
}catch{
 console.error('Runpod MCP could not start. Check runpodctl doctor and installed dependencies.');
 process.exitCode=1;
}
