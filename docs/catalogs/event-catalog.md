# Event catalog

The v1.4 §33 table in the [source](../../RIFAD_v1.4_FINAL.docx) ([rendition](../architecture/generated/rifad-v1.4.md#section-33)) is authoritative for event names, planes, ordering, producers and intended consumers. This file tracks implementation only: add a row when an event's producer ships, and never change a published version in place (add `.v2`).

Every event uses the [`EventEnvelope`](../../libs/shared/events/src/envelope.ts) contract: catalog type `<context>.<name>.v<n>`, plane, ordering scope, tenant/branch, aggregate type/ID/version, UTC `occurredAt`, correlation/causation, idempotency key, payload of at most 64 KiB.

## Implemented events

| Event type | Plane / ordering | Producer (context, runtime) | Payload contract | Consumers (name → context) | Data classes | Status / evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `restaurant.check.opened.v1` | EDGE / PER_AGGREGATE (check) | Ordering, Edge | `CheckOpenedV1` | none yet | internal | B009b/B009c, pending verification |
| `restaurant.check_round.submitted.v1` | EDGE / PER_AGGREGATE (check) | Ordering, Edge | `CheckRoundSubmittedV1` | Kitchen, consumption (planned) | internal, financial (prices) | B009b/B009c, pending verification |
| `restaurant.item.voided.v1` | EDGE / PER_AGGREGATE (check) | Ordering, Edge | `ItemVoidedV1` | Kitchen, consumption reversal (planned) | internal | B009b/B009c, pending verification |
| `restaurant.check.cancelled.v1` | EDGE / PER_AGGREGATE (check) | Ordering, Edge | `CheckCancelledV1` | Kitchen (planned) | internal | B009b/B009c, pending verification |

Payload types and `validateOrderingPayload` live in [ordering-contract](../../libs/restaurant/ordering/contract/src/events.ts). Platform tests also use synthetic `platform.*` events.

## Row template

| Event type | Plane / ordering | Producer (context, runtime) | Payload contract | Consumers (name → context) | Data classes | Status / evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `restaurant.check_round.submitted.v1` | EDGE / PER_AGGREGATE | Ordering, Edge | link to schema | `kitchen.tickets` → Kitchen | internal | Planned (B009) |

Rules: Edge-plane events never enter the Cloud outbox (ADR-041); payloads list their data classes and contain no card data; consumer names are stable because they key durable state (`events.consumer_processed` / `events.consumer_position`).
