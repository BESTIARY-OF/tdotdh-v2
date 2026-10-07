import assert from 'node:assert/strict';
import { createFrontierBatch, FRONTIER_BATCH_SCHEMA, sliceFrontierBatch } from '../src/frontier-batch-contract.js';
import { createFrontierPrefilter, FRONTIER_PREFILTER_SCHEMA } from '../src/frontier-prefilter.js';
import { runFrontierBatch } from '../../../packages/search-worker/src/frontier-batch-executor.js';

const mask = (word) => { const value = new Uint32Array(128); value[0] = word; return [...value]; };
const candidates = [
  { parentMask: mask(0b0010), candidateMask: mask(0b0010), depth: 1, nodeCursor: 0 },
  { parentMask: mask(0b0010), candidateMask: mask(0b0100), depth: 2, nodeCursor: 1 },
];

const batch = createFrontierBatch([
  { id: 0, depth: 1, parentCells: [{ x: 0, y: 0 }], candidateCells: [{ x: 0, y: 0 }], placements: [{ id: 3, cells: [{ x: 0, y: 0 }] }] },
  { id: 1, depth: 2, parentCells: [{ x: 0, y: 0 }], candidateCells: [{ x: 1, y: 0 }], placements: [{ id: 3, cells: [{ x: 1, y: 0 }] }] },
  { id: 2, depth: 3, parentCells: [{ x: 0, y: 0 }], candidateCells: [{ x: 2, y: 0 }], placements: [{ id: 3, cells: [{ x: 2, y: 0 }] }] },
]);
assert.equal(batch.schema, FRONTIER_BATCH_SCHEMA);
assert.deepEqual(sliceFrontierBatch(batch, { nodeOffset: 1, maxNodes: 1 }).candidates.map(candidate => candidate.id), [1]);
assert.equal(sliceFrontierBatch(batch, { nodeOffset: 3, maxNodes: 1 }).complete, true);

const used = await createFrontierPrefilter({ accelerator: { validate: async () => ({ status: 'completed', backend: 'test-webgpu', validity: [0, 1] }) } }).prefilter(candidates);
assert.equal(used.schema, 'tdotdh.webgpu-frontier-validator.v0');
assert.deepEqual(used.validity, [0, 1]);
assert.deepEqual(used.prefilter, { schema: FRONTIER_PREFILTER_SCHEMA, status: 'used', backend: 'test-webgpu', parity: 'verified', candidateCount: 2 });

const mismatch = await createFrontierPrefilter({ accelerator: { validate: async () => ({ status: 'completed', backend: 'test-webgpu', validity: [1, 1] }) } }).prefilter(candidates);
assert.deepEqual(mismatch.validity, [0, 1]);
assert.deepEqual(mismatch.prefilter, { schema: FRONTIER_PREFILTER_SCHEMA, status: 'fallback', backend: 'cpu-oracle', reason: 'validity-mask-mismatch', candidateCount: 2, rejectedBackend: 'test-webgpu' });

const unavailable = await createFrontierPrefilter().prefilter(candidates);
assert.deepEqual(unavailable.validity, [0, 1]);
assert.equal(unavailable.prefilter.reason, 'frontier-accelerator-unavailable');

const baseRequest = {
  operation: 'frontier-batch',
  mode: 'breadth',
  cursor: { depth: 0, nodeOffset: 1, rootChoice: 4 },
  budget: { maxNodes: 1, maxMilliseconds: 1000 },
  frontierBatch: batch,
  knownSignatureHints: [],
};
const resumed = await runFrontierBatch(baseRequest);
assert.equal(resumed.mode, 'breadth');
assert.equal(resumed.nodes, 1);
assert.equal(resumed.cursor.nodeOffset, 2);
assert.equal(resumed.canonicalSignatures.length, 1);

const depthRun = await runFrontierBatch({ ...baseRequest, mode: 'depth', cursor: { ...baseRequest.cursor, nodeOffset: 2 } });
assert.equal(depthRun.mode, 'depth');
assert.equal(depthRun.cursor.nodeOffset, 3);

let cancelled = false;
const cancelledRun = await runFrontierBatch({ ...baseRequest, cursor: { ...baseRequest.cursor, nodeOffset: 0 }, budget: { maxNodes: 2, maxMilliseconds: 1000 } }, {
  reportProgress: () => { cancelled = true; },
  isCancelled: () => cancelled,
});
assert.equal(cancelledRun, null);

console.log('frontier prefilter tests passed');
