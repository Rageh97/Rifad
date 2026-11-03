# ADR-044 Branch authority mode: CLOUD (website-only) or EDGE (full operations)

- Status: Accepted
- Date: 2026-11-03
- Owner / approver: repository owner (approval evidence: explicit user approval of ADR-044 in this project conversation on 2026-11-03, after review of the final proposal; recorded in [B010P](../../work/batches/B010P.md))
- Source sections: v1.4 §12.2, §13, §13.1, §24.1, §29.3, §30; related ADRs: ADR-020, ADR-022, ADR-024, ADR-029, ADR-034, ADR-037, ADR-038, ADR-039, ADR-042, ADR-043
- Supersedes / amends: amends the scope of v1.4 §13 ("Branch Operations always Edge-first"), ADR-037, §24.1 ("no PostgresCheckWriter for a branch Check") and ADR-039 to EDGE-mode branches; ADR-022 becomes the exit criterion of the full-operations track (F1), not a website launch criterion. The v1.4 DOCX is unchanged; amendments are listed in the [architecture index](../index.md#recorded-amendments-to-the-v14-baseline).

## Context

On 2026-11-03 the owner made the restaurant or café website and its online ordering the first commercial priority of SYS1 ([G17](../../work/decisions.md)). A website subscriber must be able to publish a site and receive online orders from a web dashboard without installing anything locally. A branch that runs POS always runs Edge as an essential part of POS, and the Cloud never writes branch operational state without an approved ADR ([G08](../../work/decisions.md)). v1.4 defines no writer for the orders of a branch that has no Edge (§13, §24.1).

## Decision

1. **Mode.** Each branch has exactly one authority mode, `CLOUD` or `EDGE`, and a monotonically increasing authority epoch, both owned by Organizations. An organization may mix modes across branches. A branch may be `EDGE` only with the Branch Operations entitlement. Subscription changes never switch a mode by themselves.
2. **Writers.** `CLOUD`: Ordering, Payments, Billing and Fiscalization run their Cloud runtime profile and are the only writers for that branch. `EDGE`: v1.4 Edge-first rules apply unchanged, including offline operation.
3. **Single writer.** Every branch-scoped write carries the epoch. Writers reject a wrong mode or a stale epoch. The Cloud inbox rejects Edge events for a branch that is not `EDGE` at that epoch. A database constraint rejects Cloud check rows for a branch that is not `CLOUD` at the current epoch, in the same transaction. Loss of connectivity never changes a mode; the Cloud is never a fallback writer for an `EDGE` branch (ADR-029 unchanged).
4. **Online order intake** is Cloud-owned, idempotent and price-snapshotted in both modes. Acceptance creates the check at the branch's writer: Cloud Ordering (`CLOUD`) or the Edge through the branch command queue (`EDGE`). Unaccepted orders expire with payment voided or refunded; online ordering pauses automatically for a branch with no active order dashboard (`CLOUD`) or no Edge heartbeat (`EDGE`).
5. **Payment paths** follow what the provider and payment method support: (A) authorize at checkout, capture on acceptance, void on rejection or expiry; (B) capture at checkout, automatic refund on rejection or expiry; (C) pay at handover. Payment results are accepted only from verified provider notifications confirmed by a provider status query, deduplicated by provider transaction ID. Late, duplicate and failed payments and refunds have explicit states and an operator follow-up queue. No card data enters RIFAD (ADR-034).
6. **Payment and invoice timing is fixed by approved business and tax rules, not by a free setting.** The applicable timing for each path is the one approved by a qualified Saudi tax/ZATCA specialist and recorded under [G06](../../work/decisions.md). Configuration may only select among approved timings and cannot produce a non-compliant sequence. A check never closes without a tender allocation and a Billing document with its required fiscal state; in `CLOUD` mode this happens in one Cloud transaction. **Financial launch** (the first real paid order) is gated on the specialist review and on passing the acceptance tests below, including ZATCA sandbox acceptance.
7. **Cloud fiscalization.** One Cloud EGS per `CLOUD` branch, with its own CSID and its own ICV/PIH chain. Issuance per EGS is serialized by one database lock. Private keys live in a key or secret service, never in plaintext tables. Reporting and clearance run through the outbox and the ZATCA adapter outside the transaction (§12.2, §29.3). Billing owns the invoice and its business number; Fiscalization owns the chain, signing and ZATCA state (ADR-020). Not approved for production until specialist review and ZATCA sandbox acceptance.
8. **Mode change** is an audited, resumable state machine: requested, preparing, draining, switching, verifying, then completed or aborted. A readiness check must pass first: no open checks or intakes; no pending authorizations or non-final payments; refunds either final or tracked in the operator queue; every closed check invoiced; an active EGS with a valid production certificate for the new mode; and, for `EDGE`, an activated healthy Edge holding the current projection that has passed a check with no financial effect. Abort before switching leaves the branch unchanged. After switching, rollback to `CLOUD` is allowed only if the Edge wrote nothing at the new epoch. `EDGE` to `CLOUD` additionally requires a confirmed final sync and Edge certificate revocation.
9. **Historical continuity after a mode change.** Orders, payments, invoices, credit notes and refunds from earlier epochs remain immutable and keep working: a later refund of an earlier-epoch sale is processed through the provider by the Cloud and its credit note references the original invoice. If ZATCA does not allow a credit note from a different EGS to reference the original invoice, the earlier Cloud EGS stays active in corrections-only mode for that branch. Pending ZATCA reporting of earlier documents continues after the switch. Reports and accounting combine both epochs by branch and event time.
10. **Shared logic, one platform.** Domain and application code is shared across modes; only repositories and runtime adapters differ (§24.1). One Cloud database serves every plan; no separate system or database per subscription type.

## Alternatives

- Require Edge for any online ordering: contradicts G08 and blocks website-only customers.
- Notification-only online orders without state: no acceptance, payment, invoice or tracking; not a complete commerce website.
- Cloud as a fallback writer for `EDGE` branches: violates ADR-029.
- A separate system or database per plan: duplicates business logic; rejected.

## Consequences

- New Cloud runtime profiles for Ordering, Payments, Billing and Fiscalization, and a new Cloud-owned Storefront context (site, pages, theme, media references, domains, SEO). Catalog, Pricing, Promotions and Customers keep their ownership.
- Branch mode and epoch become part of Edge activation and of every branch-scoped command.
- Execution order changes to W0, W1 (first website), W2a (first real order), W2b, then F1 and F2 (the v1.4 M1A/M1B Edge content); see the [roadmap](../../work/roadmap.md). Existing implemented work is kept; nothing is rebuilt without a proven reason.
- Critical-path decisions: G12 before W0 ends; G17 before W1; ZATCA specialist review, G16 and G07 before the first real order; G09 before W2b.

## Enforcement and evidence

Acceptance tests AT-01 to AT-14 in the [roadmap](../../work/roadmap.md#acceptance-tests) hold this decision, including:

- epoch fencing in every writer and the database constraint (AT-01);
- idempotent intake and payments (AT-02, AT-03);
- payment paths in the provider sandbox (AT-03);
- atomic Cloud sale finalization (AT-04);
- ICV/PIH continuity and ZATCA sandbox acceptance (AT-05, AT-06);
- mode-change readiness, recovery and historical continuity, including refunds after a switch (AT-07, AT-08);
- plan rules (AT-09);
- tenant isolation on public reads (AT-10);
- shared domain tests against both repositories (AT-13).

No guarantee is claimed until its test exists and passes.
