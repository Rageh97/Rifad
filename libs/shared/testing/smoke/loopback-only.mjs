// Test-only outbound guard: no TCP connection is needed by a Batch 1 child.
import net from 'node:net';

net.Socket.prototype.connect = function () {
  throw new Error('TEST_OUTBOUND_TCP_FORBIDDEN');
};

global.fetch = async function () {
  throw new Error('TEST_OUTBOUND_FETCH_FORBIDDEN');
};
