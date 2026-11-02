export { EDGE_MIGRATIONS, EdgeStoreError, migrateEdge, openEdgeStore } from './store';
export type { EdgeDatabase, EdgeIdentity, EdgeMigration, EdgeStore, EdgeStoreOptions } from './store';
export { EdgeScopeError, appendLocalEvent, markLocallyDispatched, markSyncedThrough, pendingCloudSync, pendingLocalDispatch } from './local-outbox';
export type { LocalEvent } from './local-outbox';
export { dispatchLocalEvents, startLocalDispatcher } from './dispatcher';
export type { DispatchResult, LocalConsumer, LocalDispatcherHandle } from './dispatcher';
