# Quality and Definition of Done

The root instructions hold permanent architectural rules. This file defines the review process, not a second architecture.

## Task workflow

1. Resolve authorized task, scope, prerequisites and decision blockers.
2. Inspect owner contracts, applicable instructions, relevant architecture sections and existing patterns.
3. Record intended behavior, acceptance cases and impact in the batch/task record.
4. Implement the smallest maintainable change within approved boundaries.
5. Execute applicable verification, including failure paths.
6. Review the diff, update changed documentation and record evidence.
7. Stop at the authorized batch boundary. Release/provisioning requires its own authorization.

## Measurable completion

For each dimension provide evidence or a short not-applicable reason:

| Dimension | Required evidence when affected |
| --- | --- |
| Correctness | Acceptance, invalid-input and boundary cases pass |
| Architecture / ownership / authority | Context owner and runtime recorded; boundary checks pass |
| Security / tenant isolation / authorization | Relevant negative tests; scope and privileged operations checked |
| Concurrency / idempotency | Contention and duplicate operations tested with actual relevant persistence |
| Failure handling | Defined outcomes for timeout, crash, retries and partial success |
| Observability | Actionable safe failures; no credentials or unnecessary sensitive data in output |
| Performance | Workload/budget and measurements for affected critical paths |
| Maintainability | Existing patterns examined; no unexplained duplicate utility or speculative abstraction |
| Compatibility / migrations | Supported upgrade and contract compatibility evidence |
| Rollback / recovery | Tested recovery procedure for affected persistent/deployment behavior |
| Tests / documentation | Required suites pass; changed contracts/runbooks/decisions updated |

No universal coverage percentage replaces invariant tests. No functional test proves an unimplemented persistence or security guarantee. Unresolved release blockers prevent completion. Low-impact documentation changes need link/source review, not invented load tests.

## Completion report

Status: COMPLETE, IMPLEMENTED—VERIFICATION PENDING, or BLOCKED.
Include task/batch, grouped file links, architectural impact, security impact, performance impact, exact verification results, limitations and next eligible work (not started). Keep full logs in evidence artifacts. Separate completed child tasks from open parent tasks. CI/hosting controls cannot be claimed active merely because workflow files exist.

## Change and exception control

Use the [decision register](../work/decisions.md) for unresolved decisions. New architecture decisions need source references, alternatives, consequences, named approval and supersession links where applicable. Do not manufacture ADR rationale missing from the baseline.

An exception record requires id, rule, scope, rationale, owner, approvalEvidence, tests, reviewAction and expiresAt. Validate test/action links and expiry. If a time limit is inapplicable, record an explicit approved rationale instead. Core architectural changes cannot use this mechanism. Review governance/enforcement changes with negative fixtures.
