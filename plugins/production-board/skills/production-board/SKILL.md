---
name: production-board
description: Initialize and open a local video production board to review scene Markdown, shot cards, reference media, selected candidates, and revision notes before generation.
---

# Production Board

Resolve the plugin root two levels above this skill directory. The user's media workspace is separate from the plugin installation. Read its instructions and story documents before editing production data.

## First use after plugin installation

Resolve the installed plugin root two levels above this skill directory. When the user asks to initialize or use this plugin, run `node <plugin-root>/scripts/onboard.mjs --workspace <absolute-media-workspace>`. Resolve the workspace from context or ask if missing. This installs locked dependencies and builds a reusable runtime outside the plugin cache, creates a generic board only if absent, and performs a read-only Runpod diagnosis. No paid resource is created.

Use the returned `runtime` and script paths for all subsequent commands, not the installation cache. Re-running setup reuses a complete matching runtime. On failure, report the actual error and fix it; do not claim initialization finished. Never remove a runtime lock without confirming no setup process owns it.

If runpod reports `binary_missing`, install the official runpodctl for the user's OS using current official instructions (use an available official Runpod skill). Respect execution permissions; do not request or print an API key in chat. If authentication is missing, guide the user through `runpodctl doctor` using a local interactive terminal; if credentials already work, skip it. Re-run diagnose after setup. The board can still be used while Runpod is unconfigured. MCP is optional; CLI is sufficient and uses the same credential source.

After setup, start the returned board script with `start --workspace <workspace> --port 4317` in a kept foreground session and open its localhost URL. Source preparation is automatic; users need not run npm commands themselves. If a board already exists, preserve it. Do not convert first-use setup into a paid generation request. `run/resume/cleanup` remain unavailable in this alpha.

## Start

The onboarding command above handles dependencies and builds; use its runtime root below.
For a new workspace, run `node <plugin-root>/scripts/board.mjs init --workspace <absolute-workspace>` to create an original two-card sample without overwriting existing files. For existing material use the Markdown format and source configuration described in [README](../../README.md).

Run `node <plugin-root>/scripts/board.mjs start --workspace <absolute-workspace> --port 4317`, keep the foreground terminal session, and open the returned localhost URL. Use `status` with the same arguments to inspect it. Stop only the terminal you started with Ctrl+C. If the port belongs to another workspace/service, choose another port.

## Review

State is saved in `<workspace>/board/project.json`, with revision snapshots in `board/history/`. Source Markdown and media remain separate. Preserve item IDs, material paths, approved content, and current revision. Use the board's save flow or inspect the API before scripting writes; stale writes are rejected.

Distinguish planned duration from actual media duration. Comments remain local; they are not automatically sent to an agent. Read them when asked, and verify saved selections by reloading. Report missing media explicitly.

Runpod preparation is a separate [runpod-workflow skill](../runpod-workflow/SKILL.md). The board itself does not provision GPUs or generate media.
