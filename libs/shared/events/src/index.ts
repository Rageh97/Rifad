export { EVENT_PLANES, EnvelopeError, MAX_PAYLOAD_BYTES, ORDERING_SCOPES, validateEnvelope } from './envelope';
export type { EventEnvelope, EventPlane, OrderingScope } from './envelope';
export { classifyPosition, createOrderingGuard, orderingKey } from './ordering';
export type { OrderingDecision, OrderingGuard, OrderingObservation } from './ordering';
