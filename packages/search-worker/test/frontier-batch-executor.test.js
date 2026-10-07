import assert from 'node:assert/strict';
import { createCpuWorkerHandler } from '../src/cpu-worker-entry.js';
import { createFrontierBatch, FRONTIER_BATCH_SCHEMA } from '../src/frontier-batch-contract.js';

const batch = createFrontierBatch([
  { id: 0, depth: 1, parentCells: [{ x: -1, y: 0 }], candidateCells: [{ x: -1, y: 0 }], placements: [{ id: 3, cells: [{ x: -1, y: 0 }] }] },
  { id: 1, depth: 1, parentCells: [{ x: -1, y: 0 }], candidateCells: [{ x: 0, y: 0 }], placements: [{ id: 3, cells: [{ x: 0, y: 0 }] }] },
]);
assert.equal(batch.schema, FRONTIER_BATCH_SCHEMA);

const events = [];
const handler = createCpuWorkerHandler({
  postMessage: event => events.push(event),
  frontierValidator: { validate: async candidates => ({ status: 'completed', backend: 'test-webgpu', validity: candidates.map(candidate => candidate.parentMask.some((word, index) => word & candidate.candidateMask[index]) ? 0 : 1) }) },
});
await handler({
  type: 'start', protocolVersion: 1, operation: 'frontier-batch', requestId: 'frontier-1', presetFingerprint: 'preset-v0', catalogRevision: 'catalog-v0', seed: 'seed-v0', mode: 'breadth',
  ticket: { presetFingerprint: 'preset-v0', familyId: 'F-0RHDG0U', pass: 0, threadId: 0 }, cursor: { depth: 0, nodeOffset: 0, rootChoice: 0 }, budget: { maxNodes: 2, maxMilliseconds: 1000 }, pieces: [{ id: 3, cells: [{ x: 0, y: 0 }] }], knownSignatureHints: [], frontierBatch: batch,
});

assert.deepEqual(events.map(event => event.type), ['started', 'progress', 'progress', 'result', 'completed']);
assert.deepEqual(events[3].canonicalSignatures.length, 1);
assert.equal(events[3].frontier.status, 'used');
assert.equal(events[3].frontier.parity, 'verified');
assert.equal(events[3].cursor.nodeOffset, 2);

console.log('frontier batch executor tests passed');
