# Edge composition scope

Read the root instructions and [B001](../../docs/work/batches/B001.md).

This directory is the Edge composition root, not a new business context. Keep it independently bootable. Its liveness cannot depend on Cloud, Worker, database, Redis, BullMQ or external providers. Batch 1 contains only validated local configuration and liveness; no persistence, events, synchronization or restaurant logic.

Use the runtime-config public entry point. Keep application code in this directory separately registered and tagged as runtime:edge. Run independent-startup smoke tests after bootstrap changes. Do not confuse liveness with operational readiness or offline-sale capability.
