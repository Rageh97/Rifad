# Execution roadmap after ADR-044

Source: [ADR-044](../architecture/adr/ADR-044-branch-authority-mode.md) (accepted 2026-11-03), v1.4 §30–32 and the [decision register](decisions.md). This is a planning view. It grants no authorization: each batch still needs explicit user approval recorded in a batch file. The v1.4 milestone text is unchanged; this file records the approved resequencing.

## Order

The restaurant or café website is the first commercial product. Website and online ordering ship first on the Cloud (CLOUD-mode branches). Full restaurant operations on the Edge (EDGE-mode branches) follow on the same platform, data and business logic.

| Phase | Content | Entry conditions | Exit |
| --- | --- | --- | --- |
| W0 Foundation for the website | Branch authority mode and epoch (Organizations); host-to-tenant resolution with RLS for public reads; Catalog/Menu and minimal Pricing; media storage port; Storefront context skeleton; admin and public web app shells; Cloud Ordering profile with epoch fencing | ADR-044 accepted; G04 price precedence for Pricing; G12 vendor before W0 ends | W0 tasks complete with tests; AT-01 (Cloud side), AT-10 |
| W1a Website preview | A working professional site from one template: branding, home/menu/about/branches/contact pages, banners and media, full menu display, Arabic/English, subdomain, preview and publish, mobile-friendly admin. Usable for demos and trials | W0; G17 answers on templates/pages/languages | Demonstrable; not a W1 completion |
| W1b Sellable website | Remaining templates, onboarding wizard, offers display, custom domain with automatic TLS, SEO (metadata, sitemap, structured data, share images), version rollback, performance/accessibility budget | W1a; G16 domain/TLS/CDN tooling; G02 web performance budget | **First website launch.** W1 is complete only when AT-10 and AT-12 pass |
| W2a First real order | Guest cart and checkout, pickup with pay at handover (path C), order dashboard (sound alert, auto/manual acceptance, prep time, status, pause), order tracking page, basic notifications, Cloud sale finalization with simplified invoice, cancellation and cash refund with credit note | W1; ZATCA specialist review (G06); G16 and G07 for customer data; notification provider | **First real order.** Financial launch only after AT-02, AT-04, AT-05, AT-06, AT-11 pass |
| W2b Complete e-commerce | Online payment paths A and B with provider refunds, delivery zones/fees/minimum, customer accounts (OTP, addresses, history), coupons and simple offers, customers/orders/basic reports in the admin, scheduled orders | W2a; G09 provider and sandbox | AT-03, AT-09 pass |
| F1 Full restaurant operations | POS, KDS and waiter on the Edge (v1.4 M1A Edge content), online orders routed to EDGE branches, mode change CLOUD↔EDGE with readiness and recovery, Edge activation and remote support, browser operation during internet loss | W2b; G08 remaining items; browser-offline prototype passes | AT-01 (Edge side), AT-07, AT-08, AT-13, AT-14 pass; ADR-022 minimum Edge |
| F2 Operational hardening | v1.4 M1B content: disconnect/reconnect hardening, full projections, inventory, recipes, costing, Edge lifecycle (signed updates, rollback, key rotation, replacement) | F1; G04, G05 | v1.4 M1B exit |
| M2–M5 | v1.4 content unchanged, after F2 | v1.4 | v1.4 |

Deferred beyond W2: free drag-and-drop editor, template marketplace, loyalty, external delivery platforms, table QR ordering, driver dispatch, extra languages, advanced analytics.

## Estimates

One developer with agents; planning ranges, not commitments. They assume decisions arrive on time, a ZATCA specialist is available and provider/ZATCA sandbox accounts exist.

| Phase | Estimate | Cumulative |
| --- | --- | --- |
| W0 | 3–5 weeks | 3–5 |
| W1 (W1a then W1b) | 8–12 weeks | 11–17 (first website) |
| W2a | 6–9 weeks | 17–26 (first real order) |
| W2b | 5–8 weeks | 22–34 |
| F1 | 10–14 weeks | 32–48 |
| F2 | 8–12 weeks | 40–60 |

The 40–60 weeks cover only the scope of this roadmap (W0–F2). They are not the completion of every future RIFAD capability; M2–M5 and the deferred items are outside them. The v1.4 Team A range (22–32 weeks) covered foundation and operations only, without the website, its editor, the order dashboard or Cloud fiscalization.

## Existing work

All implemented work is kept. Nothing is rebuilt without a proven reason.

| Existing work | Use |
| --- | --- |
| Organizations, Identity port, Authorization, Entitlements, Audit, access pipeline (B007a–d) | W0 onward, unchanged |
| Outbox, relay, inbox, ordering guard, consumers, OpenTelemetry (B005–B006e) | W0 onward, unchanged |
| Ordering domain and events (B009a, B009c) | Shared by both modes; W0 adds the Cloud repository, F1 uses the Edge one |
| Encrypted Edge store, local dispatcher, Ordering on the Edge (B007e, B007f, B009b) | F1 |

## M0 task placement

| M0 tasks | Placement |
| --- | --- |
| M0-040 pricing, M0-042 customers, M0-043 fiscalization boundary, M0-048 PCI boundary | Brought forward into W0–W2a |
| M0-029 Edge operational API, M0-044 Edge prototype, M0-049 Cloud-to-Edge commands, M0-050 Edge lifecycle | F1 |
| M0-041 costing contract | F2 (G04, G05) |
| M0-046 RLS verification gate | Before W1b launch, then again at F1 |
| M0-051 resilience drill | M0 exit, now at F1 |

## Acceptance tests

A phase is done only when its tests pass in a real run with recorded evidence. No guarantee is claimed before its test exists.

| ID | Test | Passes when | Phase |
| --- | --- | --- | --- |
| AT-01 | Single writer: Cloud write for an EDGE branch, Edge write for a CLOUD branch, stale epoch, direct database write bypassing code | All rejected and audited; no row created | W0 (Cloud), F1 (Edge) |
| AT-02 | Idempotency: same checkout twice, provider notification three times, acceptance command replayed | One order, one payment, one invoice | W2a |
| AT-03 | Payment paths A/B/C in the provider sandbox: accept, reject, expiry, cancel after acceptance, partial refund, late payment after expiry, two payments for one order | Every amount is captured for an accepted order, refunded or voided; none left without a state | W2b (C in W2a) |
| AT-04 | Sale finalization: forced failure at each closing step | No closed check without invoice and tender allocation; no invoice without a check | W2a |
| AT-05 | Invoice chain under concurrent issuance on one EGS and on two | ICV continuous without gaps or duplicates; each hash links to the previous | W2a |
| AT-06 | ZATCA sandbox: onboarding, compliance checks, reporting of simplified invoices and credit notes, retry after ZATCA outage | All accepted in the sandbox and reviewed in writing by the specialist | W2a |
| AT-07 | Mode change: readiness with each blocking item, success, failure at each stage, rollback before any Edge write, rollback refused after an Edge write, two concurrent requests | No loss or duplication of any order, payment, invoice or refund; historical records identical before and after | F1 |
| AT-08 | Refund after mode change for a sale closed in the CLOUD epoch | Refund and credit note correct and linked to the original invoice; no duplicate | F1 |
| AT-09 | Plans: website-only without Edge; upgrade does not switch mode; downgrade of an EDGE branch blocked until it moves to CLOUD | No Edge required for website subscribers; no working branch stops suddenly | W2b, F1 |
| AT-10 | Tenant isolation: requests on different restaurant domains, forged hosts, public menu reads | No cross-tenant read or write, including the public path | W0, W1b |
| AT-11 | Missed orders: dashboard closed, order without response | Online ordering pauses within the timeout; pending order expires with refund and customer notice | W2a |
| AT-12 | Website quality on a mid-range phone and mobile network; accessibility; Arabic and English | Meets the approved G02 budget; checkout works fully on mobile | W1b, W2a |
| AT-13 | Same Ordering rules on the PostgreSQL and SQLite repositories | Identical results | W0 (Cloud), F1 |
| AT-14 | Browser operation during internet loss (G08 tests T1–T13) | All pass before Edge with POS is approved | F1 |
