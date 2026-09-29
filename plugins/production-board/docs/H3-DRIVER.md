# H3 execution driver

`h3-driver.py` implements the H3-specific stages used by the lifecycle controller. It does not create or delete Pods and does not receive the Runpod API key. Cloud ownership, budget deadlines, locking of a local run, and cleanup are the controller's responsibility.

The adapter invokes:

```sh
python3 scripts/h3-driver.py preflight --request /path/to/request.json
```

Use a Python environment with `scripts/media-check-requirements.txt` installed. `ssh`, `scp`, and `runpodctl` must be available locally. Bootstrap also requires Git, curl, and the existing CUDA Python environment on the owned ComfyUI template Pod. An ordinary Python-only Pod is not sufficient.

A request has `{ "workspace": "/absolute/project", "run": { "runId": "stable-id", "plan": { "executionConfig": {} }, "execution": {} } }`.

Example `executionConfig` (model-specific API graph must already exist; these are placeholders):

```json
{
  "graph": "production/shot-api.json",
  "graphSha256": "SHA256_OF_API_GRAPH",
  "inputs": [
    { "source": "production/start.png", "target": "start.png", "sha256": "SHA256_OF_START_IMAGE" }
  ],
  "expected": { "width": 1344, "height": 768, "frames": 141, "fps": 24 },
  "bootstrap": true,
  "comfyRoot": "/workspace/runpod-slim/ComfyUI",
  "remotePython": "/usr/local/bin/python3",
  "ssh": { "keyFile": "~/.runpod/ssh/runpodctl-ssh-key" }
}
```

Graph/material hashes are required. The approved plan prompt and seed must also match the H3 graph. The controller freezes graph/material hashes when it creates a plan. Each `LoadImage` filename in the API graph must match one input `target`. The driver rewrites these into a run-specific Comfy input directory and rewrites the single `SaveVideo` output prefix into a run-specific directory. Shape and FPS in the graph must match `expected`.

SSH host/port can come from `run.execution.ssh`, or `executionConfig.ssh`. Otherwise the driver calls `runpodctl ssh info <podId> -o json`. It accepts structured host/port/user fields or parses a returned SSH command without executing it. Unknown CLI response formats fail closed. A dedicated known-hosts file under the workspace is used by default, with `accept-new`: new hosts are recorded, changed host keys are rejected. The adapter can pass `request.runpodctl`; `RUNPODCTL_BIN` and `executionConfig.runpodctl` are fallbacks for selecting the CLI path. Nested `ssh.direct` host/ip and user/username shapes are supported, with synthetic parser tests; a live CLI response is still to be validated.

## Stage responses

| Action | Result |
| --- | --- |
| `preflight` | `ready: true`; validates local dependencies, materials, graph, key before billing |
| `prepare` | `ready: true`, `status: prepared` |
| `reconcile-job` | `status: absent`, `found` with `jobId`, or `unknown` |
| `submit` | `jobId`; reuses existing accepted job |
| `poll` | `status: running`, `failed`, or `succeeded` with remote artifact descriptor |
| `recover` | `status: recovered`, `artifacts: [{path, sha256}]`; workspace-relative path |
| `validate` | `status: validated`, `verified: true`; validates `run.outputs` (or `run.execution.artifacts`) |

Failures return one JSON object to stdout and a nonzero exit code. SSH/API output is not echoed. Remote preparation logs are saved on the Pod at `/workspace/production-board/runs/<runId>/prepare.log`.

## Initialization and first-failure prevention

Without `bootstrap: true`, preparation requires an already verified environment. With explicit bootstrap on a Pod owned by the run (`execution.podId`), it checks out the successful pinned ComfyUI commit, installs its requirements plus the two pinned inference packages, stops only `main.py` processes whose working directory matches this Comfy root, and starts ComfyUI on loopback port 8188. It verifies both the checkout and the running API using `h3-guard.py` before generation. Dirty checkouts are rejected. The environment is rechecked immediately before submission. Without an explicit `remotePython`, the driver selects `.venv-cu128/bin/python` inside ComfyUI when present, otherwise the remote interpreter executing the helper.

The five H3 files come from the pinned Hugging Face revision recorded in `h3-guard.py`; downloaded byte counts are checked before atomic promotion. Full model SHA256 verification is not currently implemented. Existing matching-sized files in the owned template are reused. This is not a substitute for the recovered-media gate.

## Idempotency boundaries

The remote helper locks one run and fsyncs `submission_pending` before posting a prompt. The request includes the stable run token in Comfy `extra_data`. If a response is lost, reconciliation searches both history and the queue for that token. A pending marker with no visible matching job is **unknown**, never permission to submit again. Multiple matching jobs are also unknown. A recorded job ID is retained even if Comfy history disappears; polling cannot interpret missing history as success or trigger regeneration.

Recovery downloads into `.part`, checks the remote SHA256, then atomically promotes into `.production-board/artifacts/<runId>/video.mp4`. Repeating recovery reuses a matching local artifact and refuses to overwrite a different one. Validation checks decoded resolution, frame count, FPS, black frames, and hash. Artistic quality, dialogue accuracy, and lip sync still need visual review.

## Verification status

Offline tests cover ambiguous submission reconciliation, duplicate-token refusal, unrelated-job isolation, durable marker writes, workspace containment, and SSH argument handling. The integrated driver has **not yet had a paid end-to-end run**. The underlying pinned H3 environment was verified in the earlier manual pilot. CLI response compatibility, fresh-template bootstrap, interrupted SSH recovery, and lifecycle cleanup must be verified in a separately budgeted live run before claiming production readiness.
