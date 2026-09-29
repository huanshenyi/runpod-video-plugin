---
name: runpod-workflow
description: Prepare Runpod image/video generation from a production board, diagnose shared CLI/MCP authentication, and manage local plans and reports. Use for Codex-assisted Runpod production preparation and the documented manual execution handoff.
---

# Runpod workflow — experimental alpha

Read [RUNPOD.md](../../RUNPOD.md) for setup and current command scope. Resolve the plugin root two levels above this skill directory. Resolve the media workspace from the active project, never from the plugin cache.

## First use after plugin installation

Resolve the installed plugin root two levels above this skill directory. When the user asks to initialize or use this plugin, run `node <plugin-root>/scripts/onboard.mjs --workspace <absolute-media-workspace>`. Resolve the workspace from context or ask if missing. This installs locked dependencies and builds a reusable runtime outside the plugin cache, creates a generic board only if absent, and performs a read-only Runpod diagnosis. No paid resource is created.

Use the returned `runtime` and script paths for all subsequent commands, not the installation cache. Re-running setup reuses a complete matching runtime. On failure, report the actual error and fix it; do not claim initialization finished. Never remove a runtime lock without confirming no setup process owns it.

If runpod reports `binary_missing`, install the official runpodctl for the user's OS using current official instructions (use an available official Runpod skill). Respect execution permissions; do not request or print an API key in chat. If authentication is missing, guide the user through `runpodctl doctor` using a local interactive terminal; if credentials already work, skip it. Re-run diagnose after setup. The board can still be used while Runpod is unconfigured. MCP is optional; CLI is sufficient and uses the same credential source.

After setup, start the returned board script with `start --workspace <workspace> --port 4317` in a kept foreground session and open its localhost URL. Source preparation is automatic; users need not run npm commands themselves. If a board already exists, preserve it. Do not convert first-use setup into a paid generation request. `run/resume/cleanup` remain unavailable in this alpha.

## Authentication and preparation

Use the user's installed `runpodctl` on PATH, or their `RUNPODCTL_BIN` executable override. `runpodctl doctor` configures credentials; don't ask for keys in chat. The optional `scripts/runpod-mcp.mjs` wrapper reads `RUNPOD_API_KEY` or the CLI configuration in the user's home directory. It does not copy keys into the plugin or Codex configuration. `scripts/mcp-config.mjs` prints connection settings without modifying them.

After the board is saved, use `node <plugin-root>/scripts/runpod.mjs diagnose --workspace <workspace>` for read-only connectivity. `plan`, `record`, `status`, and `report` operate on local state. Read CLI help and the plan validator for required fields; never invent a model revision or image digest to satisfy validation.

## Execution boundary

`run`, `resume`, and `cleanup` are intentionally disabled. Do not imply that a local plan started a GPU or that cleanup happened automatically. See [the validation note](../../docs/VALIDATION.md) for the manually verified path and [example graphs](../../examples/workflows/README.md) for model-specific references.

If the user explicitly requests a paid manual run, use available official Runpod tools/skills and current CLI help. Honor the session's existing authorization and budget. Before creation, record the price, deadline and existing resources. Immediately persist returned IDs and verify assigned GPU/location/price before model transfer. On an uncertain creation response, reconcile before retrying; names alone do not establish ownership.

Budget includes startup, downloads, idle time, compute, storage, and recovery. Local timers do not survive a sleeping/offline Mac; never promise a hard cap from them. Preserve each completed output locally and verify hashes before deleting that run's resources. A stopped Pod can still have billable storage. Confirm deletion through fresh Pod and volume listings, and distinguish estimated from settled cost. Avoid deleting unrelated resources.

Read model licenses and choose an eligible deployment region. Keep credentials off the GPU where practical. Media and prompts sent to a Pod leave the local machine; use only the inputs authorized for that run.

## Mandatory H3 execution gates

Before any manual H3 generation, read [the verified H3 run procedure](../../docs/H3-VERIFIED-RUN.md). Run `scripts/h3-guard.py environment` on the Pod before submitting prompts; reject an old/mismatched runtime. Node availability alone is insufficient. After recovery run `scripts/h3-guard.py video` with the remote SHA256 and planned dimensions/frame count. Nonzero exits stop the batch and mark the attempt validation_failed, never complete. Review the pilot visually before continuing; API success is not media success. Follow the cleanup procedure on both success and failure. These checks do not enable the disabled cloud orchestration commands.
