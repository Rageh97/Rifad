# Runtime authority matrix

v1.4 §13 and ADR-029/037/038 are authoritative: every branch-operational aggregate has exactly one writer (the Edge) in connected and disconnected modes; the Cloud receives copies/projections and requests commands; online-required flows are explicit exceptions. This matrix records, per command, where it is executed. Fill it as each context ships; the M-1-019 authority audit (G10) must sign it off before M1A (§36.3).

| Command / aggregate | Owning context | Writer runtime | Connected behavior | Disconnected behavior | Cloud path | Online-required? | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Open Check / submit round | Ordering | Edge | Edge API + SQLite + local outbox | Same | Sync → Cloud inbox → projection | No | Planned (B009) |
| Cloud-owned configuration change | Owning Cloud context | Cloud | Postgres + Cloud outbox | Not applicable | Relay → queue → consumers | Yes (Cloud-only) | Outbox/relay/consumer base (B005–B006c) |

Rules: no Cloud fallback writer for branch Check, stock, tender or invoice chains; a Cloud-originated branch command is a CLOUD_TO_EDGE command the Edge accepts or rejects; when the Edge is unreachable the command stays pending visibly.
