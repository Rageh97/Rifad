# Security standard

## Every task

Record whether the change affects (1) trust/authority/authorization/tenant boundaries, (2) sensitive data/credentials/logging/egress, (3) replay/concurrency/offline/device/recovery behavior, and (4) which negative tests demonstrate protections. A short not-applicable explanation suffices for low-risk changes.

## Sensitive changes

Authentication, RLS, finance/fiscalization, public inputs, uploads, sync, devices, keys and deployment credentials require a mini threat model in the task record:

| Field | Content |
| --- | --- |
| Assets | Data, secrets, financial/fiscal facts, availability |
| Actors / trust boundaries | User, other tenant, provider, compromised device, privileged operator |
| Entry points | API, event, file, job, local socket, migration, administration |
| Abuse | Tenant crossing, escalation, replay, race, injection, sensitive logs, offline abuse, device compromise, exposure |
| Controls / evidence | Specific control and negative test for each material abuse case |
| Residual risk | Owner and release consequence |

Reference shared threat models; record deltas instead of copying them.

## Baseline controls

Validate bounded input; default deny for unavailable required authorization context. Never log supplied configuration values in startup errors. No raw PAN/CVV/track/card PIN in business contracts; cashier PIN is a separate future authentication concern. Use secret references and distinct environment identities when providers exist. NODE_ENV and URL strings alone cannot establish credential provenance.

No real credentials/customer data in local fixtures. Secret scanning uses pinned tooling; test canaries are synthetic and constructed in memory. Nonproduction must never obtain production secret permissions. PR workflows run without production secrets or privileged deployment rights. Review dependency vulnerabilities; scanner/advisory outages are failures or explicitly pending verification, never clean results.

Batch 1 implements configuration/redaction, source scanning and dependency review only. It does not implement RLS, authentication, payment acceptance, encryption-at-rest or production credential isolation.
