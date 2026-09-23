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

The baseline ADR index is §28 of the rendition; do not invent full ADR rationales. New approved decisions may be individual ADR files later. Planning choices and unresolved items live in the [decision register](../work/decisions.md), not as amendments to the source.

The root constitution summarizes source constraints. Scoped guidance adds local procedure only. If source, summary, code or task disagree, expose the conflict; task status cannot override architecture.
