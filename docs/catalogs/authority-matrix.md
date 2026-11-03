# Runtime authority matrix

v1.4 §13, ADR-029/037/038 and [ADR-044](../architecture/adr/ADR-044-branch-authority-mode.md) are authoritative: every branch-operational aggregate has exactly one writer, chosen by the branch authority mode and fenced by its epoch. EDGE branches (running POS): the Edge, in connected and disconnected modes. CLOUD branches (website-only): the Cloud; the Cloud receives copies/projections and requests commands; online-required flows are explicit exceptions. This matrix records, per command, where it is executed. Fill it as each context ships; the M-1-019 authority audit (G10) must sign it off before M1A (§36.3).

| Command / aggregate | Owning context | Writer runtime | Connected behavior | Disconnected behavior | Cloud path | Online-required? | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Open Check / submit round (EDGE branch) | Ordering | Edge | Edge API + SQLite + local outbox | Same | Sync → Cloud inbox → projection | No | Domain and Edge repository (B009a–c); API in F1 |
| Online order intake | Ordering (intake) | Cloud | Idempotent intake, price snapshot, payment state | Not applicable (online by nature) | Accepted at the branch writer | Yes | Planned (W2a) |
| Check, tender, invoice (CLOUD branch) | Ordering, Payments, Billing, Fiscalization | Cloud | Postgres + RLS + epoch fencing + Cloud outbox; finalization in one transaction | Not applicable | Native | Yes | Planned (W0 fencing, W2a finalization) |
| Branch authority mode change | Organizations | Cloud | Audited state machine with readiness check | Not applicable | Edge activation and final sync | Yes | Planned (F1) |
| Cloud-owned configuration change | Owning Cloud context | Cloud | Postgres + Cloud outbox | Not applicable | Relay → queue → consumers | Yes (Cloud-only) | Outbox/relay/consumer base (B005–B006c) |

Rules: no Cloud fallback writer for an EDGE branch's Check, stock, tender or invoice chains, and connectivity never changes a mode; a Cloud-originated branch command is a CLOUD_TO_EDGE command the Edge accepts or rejects; when the Edge is unreachable the command stays pending visibly.
