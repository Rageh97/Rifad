# Performance standard

Measure affected behavior before optimization. M-1 supplies product SLOs; do not invent p95/p99 targets or claim small samples establish them.

For changed critical flows record workload/data size, runtime/hardware, baseline/candidate p50/p95/p99 where meaningful, throughput/errors/saturation, approved budget and profiling evidence where needed.

Review relevant query count/N+1, plans/index write cost, connection pool limits and wait time, transaction/lock duration, SQLite serialization, bounded buffers/batches, queue age/retries/backpressure, payload limits and tenant-safe cache keys/invalidation. Edge changes include CPU/RAM/disk/WAL/backlog/boot/reconnect behavior on supported hardware.

Optimize measured bottlenecks without weakening ownership, authority, authorization, isolation, audit or consistency. Prefer local solutions until proven reuse warrants abstraction.

Batch 1 measures bounded process startup/shutdown with generous test deadlines and verifies no external dependency is needed. These deadlines are test harness limits, not product SLOs or throughput claims.
