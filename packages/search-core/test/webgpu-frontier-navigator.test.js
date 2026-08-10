import assert from 'node:assert/strict';
import { createWebGpuFrontierNavigator, WEBGPU_FRONTIER_NAVIGATOR_SCHEMA } from '../src/webgpu-frontier-navigator.js';

const candidate = { pieceIds: [1], parentLabelMasks: [0], candidateMask: [1], candidatePieceIndex: 0, remainingMask: [0, 0, 0, 0] };
let calls = 0;
const stateAdapter = {
  async availability() { return { status: 'available', backend: 'webgpu' }; },
  async transition() { calls += 1; return { status: 'completed', backend: 'webgpu', parity: 'verified', candidateCount: 1, absoluteHashes: [11], canonicalHashes: [22], bufferCapacity: 4 }; },
};
const navigator = createWebGpuFrontierNavigator({ stateAdapter, ticket: { threadId: 7, familyId: 'F-0RHDG0U' }, cursor: { rootChoice: 2 } });
const first = await navigator.expand([candidate], { cursor: { depth: 1, nodeOffset: 1, rootChoice: 2 } });
assert.equal(first.navigator.status, 'resident');
assert.equal(first.navigator.epoch, 1);
assert.equal(first.navigator.readback, 'canonical-replay-only');
assert.equal(first.navigator.ticket.batchOrdinal, 0);
assert.equal(navigator.checkpoint().schema, WEBGPU_FRONTIER_NAVIGATOR_SCHEMA);
assert.equal(navigator.checkpoint().active.epoch, 1);
assert.throws(() => navigator.observeCursor({ depth: 0, nodeOffset: 2, rootChoice: 2 }), /depth cannot move backward/);
const cancelled = createWebGpuFrontierNavigator({ stateAdapter, ticket: { threadId: 8 }, isCancelled: () => true });
const cancelledResult = await cancelled.expand([candidate]);
assert.equal(cancelledResult.status, 'cancelled');
assert.equal(cancelledResult.parity, 'not-committed');
assert.equal(calls, 1);
console.log('WebGPU frontier navigator tests passed');
