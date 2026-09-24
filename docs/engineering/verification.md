# Verification standard

## Implemented Batch 1 commands

| Command | Meaning |
| --- | --- |
| `pnpm check` | lint, typecheck, build, unit, architecture, governance tests, environment/governance/source checks and process smoke |
| `pnpm check:security` | pinned Secretlint source scan and dependency advisory review (moderate or higher fails) |
| `pnpm test:architecture` | real ESLint/Nx positive and negative boundary fixtures plus graph classification |
| `pnpm test:governance` | source extraction and governance positive/negative fixtures |
| `pnpm test:smoke` | built applications, independent startup, liveness, safe failures and shutdown |
| `pnpm check:env` | environment example/ignore/toolchain checks |
| `pnpm check:governance` | instruction/link/task/dependency/exception checks |
| `pnpm architecture:verify` | exact regeneration and source checksum comparison |
| `pnpm architecture:extract` | intentional update of derived files, never source mutation |

No unexpected zero-test suite may pass. Shared config changes require all checks. CI invokes these same commands on Windows and Linux; local execution proves only its actual OS. Workflow files do not enable remote branch protection. No deployment credentials in PR jobs. Advisory/network failure is not a security pass.

## Later capabilities

Real PostgreSQL/Redis/SQLite integration, migration/RLS, E2E business flows, hardware, load and fault-injection suites are not implemented. Add separate required commands with their capabilities; do not add empty passing placeholders. Persistence guarantees require real adapters and runtime roles. Fast checks never replace required slower gates.

## Evidence and scope

Record commands, results, platform/tool versions and limitations in the task/batch. Relevant security checks supplement `pnpm check`. Required checks on the candidate revision must pass before COMPLETE. A gate relying on unavailable hardware/provider/CI is verification pending, not silently skipped.

Instruction loading: root-start Codex discovery supplies root guidance; editing Edge requires reading its nested file explicitly if not already loaded. New-session discovery should be reviewed after instruction changes. Link/scope tests validate file structure, not a model's internal prompt or compliance.

## B002E agent pipeline

The agent pipeline tests are included in pnpm check and exercise TaskSpec validation, independent scope enforcement, token budgets, exact-SHA detached worktrees and negative verifier mutation cases. Run pnpm agent:preflight from a clean checkout to validate the pinned local runtime, CLI capabilities/authentication, protected main and Windows verifier CLI/integrity probe. Run pnpm agent:run with an approved TaskSpec. The CLI re-executes under repository-pinned Node 24.21.0 if the shell defaults to another Node. Evidence is retained under ignored .agent-runs/. READY_FOR_APPROVAL means local checks, independent verification where applicable and both exact-SHA GitHub CI checks passed; it never merges a PR. Windows Antigravity runs without OS-level containment: Git integrity checks detect repository mutations and the disposable verifier worktree is removed, but writes elsewhere on the host are outside this protection. External containment is a future hardening item, not a current development gate. Record the local threat model and live canary evidence in B002E.
