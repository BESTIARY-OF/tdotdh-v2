import assert from 'node:assert/strict';
import { createWebGpuFrontierBatchLayout, WEBGPU_FRONTIER_BATCH_LAYOUT_SCHEMA } from '../src/webgpu-frontier-batch-layout.js';

const grid = { width: 33, height: 2, originX: -16, originY: -1, wordCount: 3 };
const items = [
  {
    targetCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    pieceCells: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
    fieldCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    bounds: { minX: 0, maxX: 2, minY: 0, maxY: 1 },
    lock: { enabled: 1, x: 2, y: 3 },
    candidateOffset: 0,
    candidateCount: 4,
  },
  {
    targetCells: [{ x: 3, y: 1 }],
    pieceCells: [{ x: 0, y: 0 }],
    fieldCells: [{ x: 3, y: 1 }, { x: 4, y: 1 }],
    bounds: { minX: 3, maxX: 4, minY: 1, maxY: 1 },
    lock: { enabled: 0, x: 0, y: 0 },
    candidateOffset: 4,
    candidateCount: 1,
  },
];
const layout = createWebGpuFrontierBatchLayout(items, grid);
assert.equal(layout.schema, WEBGPU_FRONTIER_BATCH_LAYOUT_SCHEMA);
assert.equal(layout.itemCount, 2);
assert.equal(layout.candidateCount, 5);
assert.deepEqual(layout.targetOffsets, [0, 2]);
assert.deepEqual(layout.pieceOffsets, [0, 2]);
assert.deepEqual(Array.from(layout.targetValues), [0, 0, 1, 0, 3, 1]);
assert.deepEqual(Array.from(layout.pieceValues), [0, 0, 0, 1, 0, 0]);
assert.deepEqual(Array.from(layout.metaValues), [2, 0, 0, 2, 0, 0, 0, 2, 0, 1, 2, 3, 1, 0, 1, 2, 2, 1, 3, 4, 3, 4, 1, 1, 0, 0, 0, 0]);
assert.notEqual(layout.fieldMasks[1], 0);
console.log('WebGPU frontier batch layout tests passed');
