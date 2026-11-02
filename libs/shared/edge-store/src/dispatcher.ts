import { classifyPosition, orderingKey, type EventEnvelope } from '@rifad/events';
import { markLocallyDispatched, pendingLocalDispatch, type LocalEvent } from './local-outbox';
import type { EdgeDatabase, EdgeStore } from './store';

/**
 * A local consumer's effect. It runs synchronously inside the SQLite transaction that also records
 * the delivery, so a local projection and its delivery record commit together. Work that leaves the
 * process (realtime push, printing) belongs in `afterCommit`.
 */
export interface LocalConsumer {
  /** Stable name; it keys durable consumer state. */
  readonly name: string;
  readonly eventTypes: readonly string[];
  readonly handle: (db: EdgeDatabase, envelope: EventEnvelope) => void;
  readonly afterCommit?: (envelope: EventEnvelope) => void;
}

export interface DispatchResult {
  readonly dispatched: number;
  /** Set when an event was held because an earlier version of its aggregate is missing. */
  readonly heldAt?: { readonly sequence: number; readonly consumer: string; readonly expected: number; readonly received: number };
}

const consumerPattern = /^[a-z][a-z0-9_.-]{0,63}$/;

/**
 * Local Event Dispatcher (M0-033, ADR-041): delivers the local outbox in commit order to local
 * consumers, with no Redis/BullMQ or Cloud dependency, so it works offline. Per consumer, a
 * redelivered event is skipped and a PER_AGGREGATE gap holds the pass (nothing after it is
 * dispatched) until the missing version arrives, so order is never broken silently.
 */
export function dispatchLocalEvents(store: EdgeStore, consumers: readonly LocalConsumer[], limit = 100): DispatchResult {
  const names = consumers.map(consumer => consumer.name);
  if (names.some(name => !consumerPattern.test(name)) || new Set(names).size !== names.length) throw new TypeError('Invalid or duplicate consumer names');
  const db = store.db;
  let dispatched = 0;
  for (const event of pendingLocalDispatch(store, limit)) {
    const subscribed = consumers.filter(consumer => consumer.eventTypes.includes(event.envelope.eventType));
    const held = deliver(db, store, event, subscribed);
    if (held) return { dispatched, heldAt: { sequence: event.sequence, ...held } };
    for (const consumer of subscribed) consumer.afterCommit?.(event.envelope);
    dispatched++;
  }
  return { dispatched };
}

class HeldEvent extends Error {
  constructor(readonly consumer: string, readonly expected: number, readonly received: number) {
    super('LOCAL_EVENT_HELD');
  }
}

/** Delivers one event to its consumers atomically; returns the hold instead of throwing it. */
function deliver(db: EdgeDatabase, store: EdgeStore, event: LocalEvent, consumers: readonly LocalConsumer[]) {
  const run = db.transaction((): void => {
    const envelope = event.envelope;
    const key = envelope.ordering === 'PER_AGGREGATE' ? orderingKey(envelope) : undefined;
    for (const consumer of consumers) {
      const recorded = db.prepare('insert or ignore into local_consumer_processed (consumer, event_id, processed_at) values (?, ?, ?)')
        .run(consumer.name, envelope.eventId, new Date().toISOString());
      if (recorded.changes === 0) continue;
      if (key !== undefined) {
        const row = db.prepare('select position from local_consumer_position where consumer = ? and ordering_key = ?').get(consumer.name, key) as { position: number } | undefined;
        const decision = classifyPosition(row?.position, envelope.aggregateVersion);
        if (decision === 'DUPLICATE') continue;
        if (decision === 'GAP') {
          // Throwing rolls back this event's partial deliveries; the caller reports the hold.
          throw new HeldEvent(consumer.name, (row?.position ?? 0) + 1, envelope.aggregateVersion);
        }
        consumer.handle(db, envelope);
        db.prepare(`insert into local_consumer_position (consumer, ordering_key, position) values (?, ?, ?)
          on conflict (consumer, ordering_key) do update set position = excluded.position`).run(consumer.name, key, envelope.aggregateVersion);
        continue;
      }
      consumer.handle(db, envelope);
    }
    markLocallyDispatched(store, event.sequence);
  });
  try {
    run.immediate();
    return undefined;
  } catch (error) {
    if (error instanceof HeldEvent) return { consumer: error.consumer, expected: error.expected, received: error.received };
    throw error;
  }
}

export interface LocalDispatcherHandle {
  stop(): void;
}

/** Polls the local outbox; reports holds and errors without stopping the branch. */
export function startLocalDispatcher(store: EdgeStore, consumers: readonly LocalConsumer[], options: {
  readonly intervalMs?: number;
  readonly onResult?: (result: DispatchResult) => void;
  readonly onError?: (error: unknown) => void;
} = {}): LocalDispatcherHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    if (stopped) return;
    try {
      const result = dispatchLocalEvents(store, consumers);
      if (result.dispatched || result.heldAt) options.onResult?.(result);
    } catch (error) {
      options.onError?.(error);
    }
    timer = setTimeout(tick, options.intervalMs ?? 200);
  };
  timer = setTimeout(tick, 0);
  return Object.freeze({ stop() { stopped = true; clearTimeout(timer); } });
}
