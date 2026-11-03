# Architecture source and navigation

The unchanged [RIFAD v1.4 DOCX](../../RIFAD_v1.4_FINAL.docx) is authoritative. [Generated searchable text](generated/rifad-v1.4.md) is nonauthoritative; never edit it manually. [Manifest](generated/manifest.json) records the source hash, extraction version and structural counts.

Run `pnpm architecture:extract` only when intentionally refreshing a source-approved rendition. `pnpm architecture:verify` regenerates in memory and compares exact output/source identity. The extractor supports this document's ordinary paragraphs and rectangular tables; unsupported embedded/merged/revision content fails rather than silently losing meaning. Source visuals/formatting are not reproduced.

| Topic | Source sections / ADRs |
| --- | --- |
| Contexts and ownership | §§6–7, 34; ADR-002 |
| Edge authority/projections/events | §13, §24.1; ADR-029, 037–041 |
| Financial/fiscal consistency | §12.2; ADR-020, 031, 039, 042 |
| Tenancy/security | §§14–15, 26; ADR-032, 034, 043 |
| Stack/repository/standards | §§21, 24–25 |
| Tests and gates | §§27, 31, 36 |
| Decisions and milestones | §§28–32, 35 |
| Official sources | §37 |

The baseline ADR index is §28 of the rendition; the [ADR register](adr/index.md) tracks status and enforcement, and do not invent full ADR rationales. Implementation catalogs: [events](../catalogs/event-catalog.md), [authority](../catalogs/authority-matrix.md), [modules](../catalogs/module-catalog.md), [compliance](../catalogs/compliance-catalog.md). New approved decisions may be individual ADR files later. Planning choices and unresolved items live in the [decision register](../work/decisions.md), not as amendments to the source.

The root constitution summarizes source constraints. Scoped guidance adds local procedure only. If source, summary, code or task disagree, expose the conflict; task status cannot override architecture.

## Recorded amendments to the v1.4 baseline

The DOCX and its rendition stay unchanged. Each approved change to a baseline rule is listed here with its ADR, so readers of the source know where it no longer applies as written.

| Date | ADR | Baseline text affected | Effect |
| --- | --- | --- | --- |
| 2026-11-03 | [ADR-044](adr/ADR-044-branch-authority-mode.md) | §13 "Branch Operations always Edge-first" | Applies to EDGE-mode branches (branches running POS). CLOUD-mode branches (website-only) have no local operations. |
| 2026-11-03 | [ADR-044](adr/ADR-044-branch-authority-mode.md) | ADR-037; §24.1 "no PostgresCheckWriter for the same branch Check" | Apply to EDGE-mode branches. A CLOUD-mode branch has the Cloud as its only writer. ADR-029 (no dual writer, no Cloud fallback writer) is unchanged. |
| 2026-11-03 | [ADR-044](adr/ADR-044-branch-authority-mode.md) | ADR-039 Sale Finalization within Edge | Unchanged for EDGE-mode branches. CLOUD-mode branches keep the same invariant in one Cloud transaction. |
| 2026-11-03 | [ADR-044](adr/ADR-044-branch-authority-mode.md) | ADR-022; §30 milestone order | Minimum Edge is the exit criterion of the full-operations track (F1). The website and online ordering ship first; see the [roadmap](../work/roadmap.md). |
| 2026-11-03 | [G08](../work/decisions.md) | ADR-024 / M-1-013 client strategy | Resolved for V1: web clients for every class; no native apps in V1. |
