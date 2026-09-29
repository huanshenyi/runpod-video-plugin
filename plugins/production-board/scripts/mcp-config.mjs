#!/usr/bin/env node
// Print connection configuration; never reads credentials or changes user settings.
import {fileURLToPath} from 'node:url';
console.log('[mcp_servers.production-board-runpod]');
console.log('command = ' + JSON.stringify(process.execPath));
console.log('args = [' + JSON.stringify(fileURLToPath(new URL('./runpod-mcp.mjs', import.meta.url))) + ']');
