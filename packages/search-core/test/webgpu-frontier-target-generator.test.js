import assert from 'node:assert/strict';
import { createWebGpuFrontierTargetGenerator, cpuGenerateFrontierTargetCandidates, cpuGenerateFrontierTargetBatch } from '../src/webgpu-frontier-target-generator.js';

const input = {
  fieldCells: [{ x: 0, y: 0 }],
  targetCells: [{ x: 1, y: 0 }, { x: 0, y: 1 }],
  pieceCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  bounds: { minX: 0, maxX: 4, minY: 0, maxY: 4 },
};
const single = cpuGenerateFrontierTargetCandidates(input);
assert.deepEqual(single.validity, [1, 0, 1, 1]);
assert.deepEqual(single.acceptedIndices, [0, 2, 3]);
const batch = cpuGenerateFrontierTargetBatch([{ pieceId: 'a', ...input }, { pieceId: 'b', ...input }]);
assert.equal(batch.items.length, 2);
assert.deepEqual(batch.items[0].validity, single.validity);
assert.equal(batch.candidateCount, 8);
const lockedInput = { fieldCells: [{ x: 4, y: 4 }], targetCells: [{ x: 1, y: 0 }, { x: 0, y: 1 }], pieceCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }], bounds: { minX: 0, maxX: 4, minY: 0, maxY: 4 }, lockedOrigin: { x: 1, y: 0 } };
const lockedSingle = cpuGenerateFrontierTargetCandidates(lockedInput);
const lockedBatch = cpuGenerateFrontierTargetBatch([{ pieceId: 'locked', ...lockedInput }]);
assert.deepEqual(lockedBatch.items[0].validity, lockedSingle.validity, 'batched CPU oracle must preserve locked origins');

const adapter = createWebGpuFrontierTargetGenerator({ gpu: {} });
const receipt = await adapter.generate(input);
assert.equal(receipt.status, 'unavailable');
assert.deepEqual(receipt.validity, single.validity);
const batchReceipt = await adapter.generateBatch([{ pieceId: 'a', ...input }]);
assert.equal(batchReceipt.status, 'unavailable');
assert.deepEqual(batchReceipt.items[0].validity, single.validity);
console.log('WebGPU frontier target generator tests passed');
