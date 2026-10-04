# Independent deadline controller

初回導入は [期限監視セットアップ](DEADLINE-SETUP.md) を参照してください。配置ファイルの生成と接続診断を利用できます。

The controller must run on a separate, continuously available host with durable storage and a process supervisor. Running it on the production Mac does not protect against that Mac shutting down. This repository supplies the service code; installation does not deploy or configure a cloud service.

## Deployment

Use Node.js 22+ and an authenticated Runpod CLI on the controller host. Keep the Runpod credential in that host's secret environment or its protected Runpod configuration. Never include either credential in the run plan or commit it.

Set these environment variables through your host's secret/configuration manager:

- `RUNPOD_DEADLINE_TOKEN`: a random bearer token of at least 32 characters; clients use the same token.
- `RUNPOD_DEADLINE_STATE_DIR`: absolute path to durable storage; keep controller state across restarts and upgrades.
- `RUNPODCTL_PATH`: optional absolute path to `runpodctl`.
- `PORT`: optional loopback port, default 4319.

Run `node scripts/deadline-controller.mjs` under a supervisor. Exactly **one process** may own a state directory; an exclusive host/PID lock enforces this. A dead owner on the same host can be recovered automatically; foreign-host, malformed, or live-owner locks fail closed. An interrupted stale-lock recovery may leave `.owner.lock.recovery`; only remove that recovery file manually after verifying every controller process has stopped. Termination must allow outstanding API calls to settle. Put an HTTPS reverse proxy in front of its loopback listener. Do not expose plain HTTP or log Authorization headers. Preserve the state directory and tombstones; deleting them removes idempotency protections. Back it up, but do not run two restored copies concurrently.

## API

All endpoints require `Authorization: Bearer <token>`.

- `GET /health`: `{ready:true, now:<ISO time>, service:"runpod-deadline-controller"}`.
- `POST /runs`: `{runId, deadlineAt, plan:{runId,executionAuthorized:true,provision:{gpuId,image,containerDiskInGb,volumeInGb,publicKey?,countryCode?,dataCenterIds?},maxHourlyUsd,budgetUsd,storageHourlyUsd?}}`.
- `GET /runs/:runId`: query state and freshly inspect active Pods; confirmed absence records deletion, inspection failures return 503.
- `DELETE /runs/:runId`: delete that run's attributed Pod and verify absence.

Run IDs are lowercase UUID v4. Responses are `{runId,status,pod,deadlineAt}`, where status is `active`, `create_pending`, `cleanup_pending`, `deleted`, or `failed`, and pod is null or `{id,name,costPerHr?}`. Repeating an identical POST returns the prior state, including terminal tombstones; changing the request returns 409. No new Pod is created by GET or DELETE.

The controller durably writes creation intent before creating the Pod itself. It serializes operations and deletes due Pods every 10 seconds and on startup. It only deletes an ID returned by that run's create call (including an explicit ID on an ambiguous error); it never adopts a Pod by matching its name alone. No network volumes are created or accepted. Pod deletion removes the Pod's attached local disks.

## Limits and recovery

This is **not a hard dollar cap**. Admission checks reserve 10% of budget and conservatively estimate storage at the higher of $0.0003/GB/hour or supplied `storageHourlyUsd`, plus the configured maximum GPU hourly rate. They reject durations over 24 hours and immediately clean up when the actual returned GPU price is missing or too high. Confirm current storage pricing before live use. API outages, controller outages, and deletion latency can extend billing. Durable storage and a supervised independent host reduce these risks; they do not eliminate them.

A create response lost before its Pod ID is durably recorded leaves `create_pending` with `pod:null`. The controller does not blindly retry or adopt by name. An operator must inspect Runpod and reconcile ownership; the controller cannot automatically delete an unattributed Pod. This also applies to a controller crash in the create-response/persist window. Treat that state as requiring urgent attention, not as proof of zero resources. Failed deletion remains `cleanup_pending` and is retried. Keep external monitoring for both conditions and controller health.

Deadline cleanup can delete generated files that have not been recovered. Recover promptly and call DELETE after verified local recovery. Budget protection takes precedence over preserving remote files at the agreed deadline. No controller has been deployed or paid resources created by the included tests.
