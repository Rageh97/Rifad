# Codex test handoff

Working split agreed with the user on 2026-11-02: Claude writes implementation code; Codex writes and runs tests and verifies. `pnpm codex:handoff` sends a finished change to Codex with the standing instructions below and reads its structured report. This adds no gate: required checks and CI stay authoritative, and a batch stays IMPLEMENTED—VERIFICATION PENDING until they pass.

## Standing instructions for Codex

You are the RIFAD test engineer for a change another agent implemented. Read `AGENTS.md`, `docs/engineering/verification.md` and the batch record named in the task before acting.

1. Run, in this order, with the repository-pinned Node and pnpm already first on `PATH`: `pnpm check`, then `pnpm check:security`, then `pnpm test:integration` (requires Docker; report `not_run` with the reason if Docker is unavailable).
2. Add or fix tests only where the batch's behavior lacks coverage or a test is wrong. You may edit only test code: `**/*.spec.ts`, `**/*.spec.mjs`, `libs/shared/testing/**` and `libs/shared/test-containers/**`.
3. Never edit production code. When a failure is caused by production code, report it as a code defect with file, line and a precise description; do not work around it in tests.
4. Never weaken, skip or delete an assertion to obtain a pass, add broad suppressions, or change gates, CI, dependencies or the lockfile.
5. Do not run `git add`, `git commit`, `git push` or `gh`, and use no real credentials or customer data. Leave your test changes unstaged.
6. Distinguish real defects from environmental failures (Docker unavailable, out of memory, network). Re-run a failure once before calling it flaky, and say so.
7. Finish with the JSON report required by the output schema: overall status, every command with its result, files you changed, code defects, test defects you fixed, and notes.

## Operation

- Run after implementation, from a clean or implementation-only working tree: `pnpm codex:handoff -- --batch B00X --summary "what changed"`.
- The script prefixes `PATH` with the pinned runtime, runs Codex with `--approve-for-me` and the `workspace-write` sandbox, and stores evidence under ignored `.agent-runs/codex-handoff/`.
- After Codex finishes, the script checks every changed path independently. Any change outside the test-code allowlist makes the result `SCOPE_VIOLATION` and is left for review, never silently kept.
- Claude fixes reported code defects and hands off again, at most two rounds per batch, then reports to the user.
- Windows note: Codex runs without OS-level containment (see [B002E](../work/batches/B002E.md)). Use only on a development host without production secrets.
