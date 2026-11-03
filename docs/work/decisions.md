# Decision register

B001 approval does not close M-1 business/compliance decisions. No fabricated approvals or dates. Each closure must add decision, accountable owner, approver, evidence, affected tasks and date; nonblocking deferral needs rationale and review trigger. Options and impacts for each entry are in the [decision worksheet](decision-worksheet.md); blocked tasks are in the [M0 backlog](backlog/M0.md).

Decisions recorded on 2026-11-02 were made by the repository owner in this project conversation (approval evidence: user chat answers on that date).

Ownership (user chat, 2026-11-01): the team is one developer with agents. The repository owner (Rageh97) is accountable owner and approver for every entry below. Assigning an owner does not close a decision. Deadline for each entry: before the first dependent batch starts.

## Business / compliance decisions

| ID | Required decision | Source | Status |
| --- | --- | --- | --- |
| G01 | Baseline / pilot / approved cut | 29.1, M-1-001–003 | OPEN. Added 2026-11-03: the restaurant/café website and online ordering are the first commercial product of SYS1 (see G17). Hardware sale, supply, inventory, shipping and maintenance are out of RIFAD scope; device integration (printing etc.) is a software capability whose compatibility requirements are defined later |
| G02 | NFR / retention / operating envelope | 29.2, M-1-004 | OPEN |
| G03 | Check / round / correction semantics | 9–10, M-1-005 | PARTIAL (2026-11-02): takeaway/delivery use the same Open Check aggregate as dine-in; voiding a submitted item needs a controlled reason code plus manager approval, recorded with actor and preparation state; M1A split payment is by items only. Added 2026-11-02: cancelling a whole check after any round was sent needs a reason code plus manager approval; a CLOSED check is never reopened (corrections only by refund/credit note). State machine per §9.1 (OPEN → CLOSING → CLOSED, OPEN → CANCELLED). Still OPEN: cancellation charges, the controlled reason-code list |
| G04 | Price / stock / UOM / valuation / snapshot policy | 11, M-1-006–008 | OPEN |
| G05 | M1A real COGS source placement versus M1B dependency | 32.1–32.2, M-1-016/019 | OPEN |
| G06 | Fiscalization / finalization / external uncertainty / recovery | 12.2, M-1-010/016 | OPEN. Added 2026-11-03 by [ADR-044](../architecture/adr/ADR-044-branch-authority-mode.md): CLOUD-mode branches issue and sign in the Cloud (one EGS per branch, own CSID and ICV/PIH chain). Payment and invoice timing per payment path is fixed by approved business and tax rules recorded here after specialist review, not by a free setting. Financial launch is gated on specialist review and ZATCA sandbox acceptance. Specialist questions: invoice timing for prepaid orders, Cloud EGS per branch, credit note referencing an invoice from another EGS, Phase 1/Phase 2 obligations of the pilot restaurant |
| G07 | Customer identity / privacy / providers / regions | 22, 29.3, M-1-009/011 | OPEN |
| G08 | Edge clients / hardware / encryption / projections / recovery | 13, M-1-012/013 | PARTIAL (2026-11-03): (1) RIFAD is software-only SaaS; it does not sell, supply or provide POS devices, printers or other equipment. (2) Every V1 user-facing client is a web client in a browser; no standalone Windows/Android/iOS apps in V1 (ADR-024 resolved for V1). Advanced geofence tracking is deferred and does not justify native apps in V1. (3) Edge-first authority is unchanged for branches running POS (ADR-029/037/038/041); the Cloud writes branch operational state only for CLOUD-mode branches under [ADR-044](../architecture/adr/ADR-044-branch-authority-mode.md). (4) Subscriptions never force POS or Edge: website, menu, content and online ordering need no Edge. A POS branch always runs Edge as an essential part of POS, not a plan option. (5) Edge is a background service that may run on the cashier computer; a dedicated device is optional. If the host stops, local operation that depends on it stops. (6) Edge setup and activation must be simple and support remote assistance with per-session consent and audit. (7) Browser operation during internet loss must be proven by real tests before approval. Still OPEN: browser-only local connectivity prototype (three candidate approaches), minimum host requirements (measured), offline operation matrix and maximum offline duration (bounded by ZATCA reporting rules), staff PIN policy, key protection and remote support (security review), host replacement, paper fallback procedure |
| G09 | Payment acceptance / PCI / provider policy | 26.1, M-1-017 | OPEN. Added 2026-11-03 by [ADR-044](../architecture/adr/ADR-044-branch-authority-mode.md): online payment uses path A (authorize, capture on acceptance), B (capture at checkout, refund on rejection) or C (pay at handover) per provider/method capability; hosted/redirect flows only (ADR-034). Still OPEN: provider, methods and their capabilities; needed before W2b |
| G10 | Context / event / data capture closure | 6–7, 33–35, M-1-014/015/019 | PARTIAL (2026-11-02): Organizations owns Membership (user ↔ organization); Identity only authenticates. Still OPEN: canonical void-event producer, exact ordering keys, Context Map v0.2 |
| G11 | Delivery capacity and pilot calendar | 32.7, M-1-018 | OPEN; capacity input recorded below |
| G12 | Identity provider (Cognito/Auth0/alternative), MFA | 35, 15; M0-013 | PARTIAL (2026-11-02): build the provider-neutral OIDC port now; vendor and MFA stay OPEN (with G07 regions). Critical path since 2026-11-03: the vendor is needed before W0 ends (admin dashboard sign-in for the first website); a local test issuer covers development only |
| G13 | Organization structure: BusinessUnit/Workspace layer; employee in several branches under one membership | 35, 14; M0-010–012 | DECIDED (2026-11-02): no BusinessUnit/Workspace layer in V1 (Organization → Branches, §14); one membership per user and organization with branch-scoped role assignments, so an employee can work in several branches |
| G14 | Approval limits for refund/discount/stock adjustment by role/amount/branch | 35, 15 | OPEN |
| G15 | Official metric formulas; channel commission/payment fee actual versus estimated before settlement | 35, 17; M-1-014 | OPEN |
| G16 | Cloud hosting provider/region and stage (VPS-first versus ECS/Fargate) | 21, 23; ADR-018 | OPEN; depends on G07. Needed before the first real order (customer personal data); custom-domain TLS/CDN tooling needed before the first website launch |
| G17 | Restaurant website and online ordering scope | Owner chat 2026-11-03; v1.4 §2, §6, §13.1; ADR-044 | PARTIAL (2026-11-03): the website is the first commercial product; a website subscriber needs no Edge or local install; W1 delivers a sellable professional site (templates, branding, pages, media, full menu, Arabic/English, subdomain and custom domain, SEO, preview/publish/rollback, mobile-friendly admin) and W2 completes e-commerce and ordering. Still OPEN: number and style of templates, editor level, pages and languages at launch, guest checkout and customer sign-in, order types, delivery zones/fees/minimum, acceptance mode, notification channels, offers, analytics tools; needed before W1 |

G05 must resolve actual source-fact capability placement before claiming M1A COGS acceptance. G04 must resolve stock rejection versus kitchen dispatch timing. G06 must distinguish required synchronous prerequisites from fact-notification events and external provider outcomes. G10 includes Membership ownership, canonical void-event producer and exact ordering keys. G12–G16 were added on 2026-11-01 because §35 open questions blocking M0 tasks had no register entry.

## Engineering decisions

| ID | Decision | Status |
| --- | --- | --- |
| E01 | Real PostgreSQL/Redis for integration tests: Docker Desktop locally plus a Linux CI integration job | DIRECTION APPROVED (user chat, 2026-11-01). Local Docker engine started by the user on 2026-11-02 and used by B005. The Linux `integration` CI job passed on GitHub for PRs #10 and #11 and on `main`. Adding it as a third required branch-protection check needs separate explicit approval after it passes. |
| E02 | Edge SQLite driver (`node:sqlite` versus `better-sqlite3`) and its encryption path | DECIDED (2026-11-02): `better-sqlite3-multiple-ciphers`, so the Edge store can be encrypted; its native build script must be allowed in pnpm. Key management and device recovery remain G08. |
| E03 | Re-verify PostgreSQL 18.x, Redis 8.x, Kysely and driver patch/security releases at B005 start (§21 version note) | PostgreSQL/Kysely/pg DONE 2026-11-02 in [B005](batches/B005.md) (18.6 by digest, Kysely 0.29.7, pg 8.23.1). Redis 8.10.3 (digest), BullMQ 6.3.17 and ioredis 6.0.0 DONE 2026-11-02 in [B006](batches/B006.md). |

## Architecture decisions after the baseline

| ID | Decision | Status |
| --- | --- | --- |
| [ADR-044](../architecture/adr/ADR-044-branch-authority-mode.md) | Branch authority mode CLOUD or EDGE; website first | ACCEPTED 2026-11-03 by the repository owner (explicit chat approval; [B010P](batches/B010P.md)). Amends the scope of v1.4 §13, §24.1, ADR-022, ADR-037, ADR-039; see the [architecture index](../architecture/index.md#recorded-amendments-to-the-v14-baseline) |

## Delivery capacity input (G11 / M-1-018)

- Capacity: one developer with agents, closest to §32.7 Team A (planning range 22–32 weeks from start, not a commitment).
- §32.7 cites ZATCA Wave 25 on 2027-02-01. The user stated on 2026-11-01 that this date is not binding for the pilot. Risk: Team A range ends after that date. Review trigger: any pilot customer or contract requiring that wave.
- G11 stays OPEN until a planning range, critical path and pilot window are approved.
- Re-estimate after ADR-044 (2026-11-03), one developer with agents, planning ranges only: first website 11–17 weeks, first real order 17–26 weeks, full scope of the [roadmap](roadmap.md) (W0–F2) 40–60 weeks. This covers only the roadmap scope; it is not the completion of every future RIFAD capability (M2–M5 and later items are outside it).
