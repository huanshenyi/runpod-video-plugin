#!/usr/bin/env node
import { createDeadlineController } from '../app/lib/runpod/deadline-controller.mjs';
import { createProvider } from '../app/lib/runpod/provider.mjs';

const directory = process.env.RUNPOD_DEADLINE_STATE_DIR;
if (!directory) throw new Error('RUNPOD_DEADLINE_STATE_DIR must name durable storage');
const controller = await createDeadlineController({ directory, token: process.env.RUNPOD_DEADLINE_TOKEN, provider: createProvider({ binary: process.env.RUNPODCTL_PATH || 'runpodctl' }) });
controller.server.listen(Number(process.env.PORT || 4319), '127.0.0.1', () => console.log('Runpod deadline controller listening on loopback; use an HTTPS reverse proxy.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await controller.close(); process.exit(0); });
