# Run lifecycle implementation plan

Goal: persistent single-shot H3 run/resume/cleanup with offline fault tests before paid verification.
Architecture: locked immutable plan + durable action intents, provider for Pod management, subprocess H3 driver, independent deadline controller interface. No credentials in state. Generation outcome and cleanup state are distinct.

- [x] Add lifecycle engine. Persist create/submit/delete intent before mutation. An ambiguous creation never repeats; only recorded response IDs confer ownership. A missing local artifact is never considered recovered.
- [x] Add durable simulator and CLI run/resume/cleanup, bounded steps, explicit live authorization, cleanup discard option and dead-owner lock recovery.
- [x] Add real H3 driver: pinned bootstrap, remote submission marker, Comfy job polling, local recovery and verification.
- [x] Require an independently enforced deletion deadline before live allocation. Refuse live mode if not configured; never call a local timer a cloud guarantee.
- [x] Test create/submit lost responses, interrupted recovery, repeated cleanup, concurrent commands, expired budgets, failed verification, changed inputs, foreign resources.
- [x] Update docs and reports. Run local tests/build/package checks. Paid test requires a fresh budget authorization, so do not create cloud resources during implementation.

Paid verification and external controller deployment remain explicitly outside this implementation turn. No billable resources created.
