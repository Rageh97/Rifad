# Compliance catalog

v1.4 §§26.1, 29.3 and 37.2 are the architecture baseline for KSA compliance (ZATCA fiscalization, PDPL, PCI scope). This is not legal or tax advice: every entry needs validation by a qualified Saudi specialist and the latest official specification before production (§29.3). Open decisions: G06 (fiscalization), G07 (privacy/providers/regions), G09 (payment acceptance/PCI).

| Requirement | Source | Owning context | Control in RIFAD | Evidence | Decision / status |
| --- | --- | --- | --- | --- | --- |
| No raw PAN/CVV/track/card PIN in RIFAD | §26.1, ADR-034 | Payments | Log redaction of card-data keys and Luhn-valid numbers | B004b tests | Partial; full boundary M0-048 (G09) |
| Personal data classified before any external transfer | §29.3, ADR-023 | Platform | Default-deny outbound guard; no processor approved | B004b tests | Partial; regions/processors G07 |
| Tenant isolation of business data | §14.1, ADR-032/043 | Platform | Forced RLS, scoped roles, audits | B005/B006 integration tests | Implemented for current tables |
| ZATCA B2C simplified invoice local issue/sign/report | §29.3, §12.2 | Billing + Fiscalization | — | — | Not started (G06) |
| ZATCA simplified invoice issued in the Cloud for CLOUD-mode branches (one EGS per branch) | ADR-044, §29.3 | Billing + Fiscalization | — | — | Not started; not approved until specialist review and ZATCA sandbox acceptance (G06, AT-05/06) |
| Payment/invoice timing per payment path follows approved tax rules | ADR-044 | Payments + Billing | — | — | Not decided (G06 specialist) |
| ZATCA B2B standard invoice clearance | §29.3 | Billing + Fiscalization | — | — | Not started (G06) |
| Credit/debit notes reference the original invoice | §29.3 | Billing | — | — | Not started |
| Data-flow register and cross-border decisions | §29.3, M-1-011 | Platform | — | — | Not started (G07) |
| Retention for invoices, audit, logs, files | §29.2 | Owning contexts | — | — | Not decided (G02) |
