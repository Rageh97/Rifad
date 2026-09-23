# RIFAD engineering instructions

## Start each task

Read [current work](docs/work/current.md), the authorized batch/task, and its milestone gate. Read applicable descendant AGENTS.md files before changing their paths; startup discovery from the repository root does not automatically load every child instruction. Inspect existing code and relevant source sections instead of rereading the whole architecture. Recheck guidance after changing checkout or scope.

Only execute authorized scope. A work index or an agent-edited status is not approval. Continue routine choices within that scope; surface unresolved decisions and continue independent work where possible. Do not begin the next batch automatically.

## Architectural constitution

[RIFAD v1.4](RIFAD_v1.4_FINAL.docx) is authoritative. The [architecture index](docs/architecture/index.md) provides searchable navigation. Generated text is nonauthoritative. Do not invent unresolved M-1 answers or silently redesign architecture.

- One context owns each business concept; use public contracts, never another context's tables or infrastructure internals (§§6–7, 24; ADR-002/015).
- Branch operational state has one Edge writer in connected and disconnected modes. Cloud receives copies/projections and requests commands, never becomes a fallback writer (§13; ADR-029/037).
- Cloud master data remains Cloud-owned; Edge packages are versioned projections, not new owners (ADR-038).
- Local Edge events remain independent of Redis/BullMQ/Cloud; state and local outbox are transactional when implemented (ADR-041).
- Required local Payments/Billing/Fiscalization state precedes check closure. External providers never participate in local ACID (ADR-039; §12.2).
- Enforce tenant/branch authorization and PostgreSQL RLS from tenant-table creation; runtime roles must not bypass it (§14.1; ADR-043).
- Preserve audit, idempotency, explicit ordering, immutable historical facts and recovery guarantees (§§19, 25–27).
- No hidden later-milestone dependency or postponed infrastructure added without an approved decision (§36.3).

These rules describe the architecture, not capabilities already implemented. Only actual tests establish guarantees.

## Implement and verify

Follow [quality and DoD](docs/engineering/quality.md), then relevant [security](docs/engineering/security.md), [performance](docs/engineering/performance.md) and [verification](docs/engineering/verification.md) sections. Mark inapplicable dimensions with a reason. Keep production credentials and real customer data out of this workspace and nonproduction execution.

Run `pnpm check` and every additional applicable gate. Do not weaken tests or add broad suppressions to obtain a pass. Exceptions must be explicit, scoped, approved, test-backed, linked to review/removal and time-bounded where applicable; no exception may silently amend an architectural invariant.

Update only changed facts in canonical records. Report status, changed files, architecture/security/performance impact, executed tests, limitations and next eligible work. Unrun checks are not passes; a child task does not complete its parent.
