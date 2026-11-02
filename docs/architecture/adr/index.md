# ADR register

The [RIFAD v1.4 DOCX](../../../RIFAD_v1.4_FINAL.docx) §28 is authoritative for every decision below; titles are copied from the [generated rendition](../generated/rifad-v1.4.md#section-28) and are nonauthoritative. Context, alternatives and consequences live in the source sections that state each decision and are not expanded here, so no rationale is invented. "Enforced by" lists only controls that exist in this repository today; it is not a claim that the decision is fully implemented.

New decisions use the [template](template.md) as `docs/architecture/adr/ADR-NNN-short-name.md`, start at ADR-044, need named approval and must not silently amend the baseline.

| ID | Decision | Status | Enforced by |
| --- | --- | --- | --- |
| ADR-001 | Use Modular Monolith for RIFAD V1 | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-002 | Strict Module Data Ownership | Accepted (v1.4 baseline) | Nx scope tags and private-import bans (`tools/architecture-policy.mjs`); migration owners |
| ADR-003 | PostgreSQL as primary OLTP database | Accepted (v1.4 baseline) | `@rifad/database` (PostgreSQL 18.6) |
| ADR-004 | Transactional Outbox for durable events | Accepted (v1.4 baseline) | `events.outbox` + `appendToOutbox` in the business transaction |
| ADR-005 | No Kafka in V1 | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-006 | Branch Edge Runtime + SQLite WAL | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-007 | Shared DB Multi-tenancy with strict scoping | Accepted (v1.4 baseline) | Tenant-scoped transactions + forced RLS |
| ADR-008 | TypeScript/Node/Nest/Fastify stack | Accepted (v1.4 baseline) | Workspace toolchain (Node 24, Nest 11.2/Fastify, Nx/pnpm, TypeScript) |
| ADR-009 | Kysely explicit persistence mapping | Accepted (v1.4 baseline) | `@rifad/database` (Kysely 0.29.7, explicit SQL) |
| ADR-010 | BullMQ for V1 background jobs | Accepted (v1.4 baseline) | `@rifad/queue` (BullMQ, dedicated `noeviction` Redis) |
| ADR-011 | Bunny Storage/CDN via ObjectStoragePort | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-012 | Independent provider for critical backups | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-013 | Analytics downstream from operational truth | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-014 | AI not source of truth; tool-based orchestration | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-015 | Nx enforced module boundaries | Accepted (v1.4 baseline) | Nx `enforce-module-boundaries` with negative fixtures |
| ADR-016 | UTC + business timezone + occurredAt model | Accepted (v1.4 baseline) | `Clock` and UTC `occurredAt` in `@rifad/kernel`/`@rifad/events` |
| ADR-017 | UUID/offline-safe identities | Accepted (v1.4 baseline) | `EntityId` (canonical UUIDs generated locally) |
| ADR-018 | VPS-first allowed; managed cloud when justified | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-019 | KSA-first baseline for SYS1 launch | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-020 | Fiscalization as first-class context; ZATCA adapter is only external transport | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-021 | Open Check + multiple Order Rounds/Submissions for dine-in | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-022 | Minimum Branch Edge included in M1 exit criteria | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-023 | Personal-data classification / PDPL cross-border governance before provider-region lock | Accepted (v1.4 baseline) | Default-deny outbound guard in `@rifad/data-classification` (no processors approved yet) |
| ADR-024 | Client platform strategy by capability (Web/PWA/Native/Managed shell) | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-025 | Intelligence Data Contract starts in M1 even when AI ships later | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-026 | Pricing and Promotions separated from Catalog ownership | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-027 | Costing & Profitability context separated from Inventory/Accounting truth | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-028 | Inventory UOM/Lot/Expiry foundation modeled before pilot data growth | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-029 | Branch operational authority is Edge-first; no normal Cloud/Edge dual writer | Accepted (v1.4 baseline) | Edge cannot depend on Cloud libraries or accept database/queue settings |
| ADR-030 | Inventory availability is policy-driven; ingredient consumption defaults to RoundSubmitted append-only movement; negative stock may be allowed with alert per policy | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-031 | Finance contexts exist from M1; M2 increases maturity instead of migrating ownership | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-032 | PostgreSQL RLS is tenant-isolation defense-in-depth for applicable tenant-owned tables | Accepted (v1.4 baseline) | Forced tenant RLS + `auditTenantTables`/`auditRuntimeRole` |
| ADR-033 | Domain events carry per-aggregate version/sequence; ordering is explicit per consumer, not global | Accepted (v1.4 baseline) | `aggregateVersion` in envelopes; ordering guard and durable consumer positions |
| ADR-034 | PCI boundary minimizes card data; prefer separate terminal/redirect/hosted/tokenized provider flows | Accepted (v1.4 baseline) | Log redaction of card-data keys and Luhn-valid numbers (full M0-048 boundary pending) |
| ADR-035 | Minimum Edge lifecycle management (signed update/rollback/key rotation/replacement) ships with M1 baseline | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-036 | Node.js 24 LTS is V1 runtime baseline; Node 26 upgrade only after LTS + compatibility validation | Accepted (v1.4 baseline) | Pinned Node 24.21.0 checked by `check:env` |
| ADR-037 | Branch-owned Open Check/Round state is Edge/SQLite authority from first domain slice; Cloud stores synced projection/canonical central copy, not competing writer | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-038 | Branch Operational Projection is versioned/atomic and includes all data required to sell without live Cloud dependency | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-039 | Sale Finalization is synchronous within Edge local authority for offline-safe branch sale: tender allocation + Billing document + required fiscal state before Check CLOSED | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-040 | Restaurant Consumption Orchestrator translates Recipe/Modifier composition into generic Inventory commands; Inventory never depends on restaurant-specific Recipe model | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-041 | Local Edge Event Dispatcher is distinct from Cloud BullMQ; durable event plane is explicit (EDGE/CLOUD/EDGE_TO_CLOUD/CLOUD_TO_EDGE) | Accepted (v1.4 baseline) | Cloud outbox accepts only CLOUD/CLOUD_TO_EDGE; Edge bans BullMQ/Redis |
| ADR-042 | POS/Cash owns drawer/count difference; Reconciliation owns provider/acquirer/bank matching; Payments owns tender/allocation | Accepted (v1.4 baseline) | Not yet enforced in code |
| ADR-043 | Tenant PostgreSQL migrations are RLS-by-default from table creation; later RLS task is a verification gate, not delayed enablement | Accepted (v1.4 baseline) | RLS created in the same migration as each tenant table; audit test |
