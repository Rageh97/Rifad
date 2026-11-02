# Module catalog

Bounded contexts, owners and data ownership come from v1.4 §§6–7 and §34 (source authoritative; Context Map v0.2 sign-off is decision G10). This catalog records what exists in the repository. Tags are enforced by [`tools/architecture-policy.mjs`](../../tools/architecture-policy.mjs).

## Implemented shared libraries

| Project | Tags (scope / layer / runtime) | Purpose | Owns data |
| --- | --- | --- | --- |
| `kernel` | shared / domain / shared | EntityId, Money, Clock, DomainEvent, DomainError, Result | — |
| `events` | shared / contract / shared | Event envelope, ordering guard | — |
| `request-context` | shared / infrastructure / shared | Request/correlation/tenant context | — |
| `logging` | shared / infrastructure / shared | Redacted JSON logs | — |
| `observability` | shared / infrastructure / shared | OpenTelemetry tracing | — |
| `data-classification` | shared / domain / shared | Data classes, outbound guard | — |
| `http-platform` | shared / infrastructure / shared | Request context, error standard, readiness | — |
| `runtime-config` | shared / infrastructure / shared | Validated local configuration | — |
| `database` | shared / infrastructure / cloud | Postgres, migrations, RLS, unit of work, outbox, inbox | `rifad`, `rifad_meta`, `events.*`, `sync.inbox` |
| `queue` | shared / infrastructure / cloud | Dedicated queue Redis via BullMQ | — |
| `outbox-relay` | shared / infrastructure / cloud | Outbox → queue relay, failed-event operations | — (uses `events.outbox`) |
| `event-consumer` | shared / infrastructure / cloud | Durable idempotent ordered consumers | — (uses `events.consumer_*`) |
| `test-containers` | shared / testing / ci | Disposable PostgreSQL/Redis for integration tests | — |

## Business contexts

Add a row per context when its first slice is authorized.

| Context | Owner | Milestone | Projects (domain / application / infrastructure / api) | Tables owned | Events produced | Public contract |
| --- | --- | --- | --- | --- | --- | --- |
| Organizations | Platform (G10: owns Membership) | M0 | organizations-domain / -application / -infrastructure (cloud) | organizations.organization, .branch, .membership | none yet | organizations-contract (`OrganizationDirectory`) |
| Identity | Platform | M0 | identity-contract / -infrastructure (cloud) | identity.external_identity (platform-level) | none | identity-contract (`TokenVerifier`, `UserDirectory`, `authenticate`) |
| Authorization | Platform | M0 | authorization-domain / -application / -infrastructure (cloud) | authorization_ctx.role, .role_assignment | none | authorization-contract (`AuthorizationQuery`, `PERMISSIONS`) |
| Entitlements | Platform | M0 | entitlements-domain / -application / -infrastructure (cloud) | entitlements.organization_feature | none | entitlements-contract (`EntitlementQuery`, `featureForPermission`) |
| Audit | Platform | M0 | audit-contract / -infrastructure (cloud) | audit.audit_event | none | audit-contract (`AuditSink`, `AuditSinkFactory`) |
