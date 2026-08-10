import assert from 'node:assert/strict';
import { cpuFrontierTopology, cpuTopologyReduction, createWebGpuFrontierTopology, DEFAULT_FRONTIER_GRID, WEBGPU_FRONTIER_TOPOLOGY_SCHEMA } from '../src/webgpu-frontier-topology.js';

function maskFor(cells) {
  const mask = new Uint32Array(Math.ceil((DEFAULT_FRONTIER_GRID.width * DEFAULT_FRONTIER_GRID.height) / 32));
  for (const { x, y } of cells) {
    const bit = (y - DEFAULT_FRONTIER_GRID.originY) * DEFAULT_FRONTIER_GRID.width + (x - DEFAULT_FRONTIER_GRID.originX);
    mask[Math.floor(bit / 32)] |= 1 << (bit % 32);
  }
  return [...mask];
}

const fullSquare = cpuFrontierTopology({
  parentMask: maskFor([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]),
  candidateMask: maskFor([{ x: 1, y: 1 }]),
  centroidMask: maskFor([{ x: 0, y: 0 }]),
});
assert.equal(fullSquare.schema, WEBGPU_FRONTIER_TOPOLOGY_SCHEMA);
assert.deepEqual(fullSquare.metrics, { area: 4, perimeter: 8, holes: 0, connected: true, centroidEdgeCoast: true, centroidCornerCoast: true, bboxArea: 4 });

const sealedCentroid = cpuFrontierTopology({
  parentMask: maskFor([{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }]),
  candidateMask: maskFor([{ x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }]),
  centroidMask: maskFor([{ x: 0, y: 0 }]),
});
assert.deepEqual(sealedCentroid.metrics, { area: 9, perimeter: 12, holes: 0, connected: true, centroidEdgeCoast: false, centroidCornerCoast: false, bboxArea: 9 });

const ring = cpuFrontierTopology({
  parentMask: maskFor([{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }]),
  candidateMask: maskFor([]),
});
assert.deepEqual(ring.metrics, { area: 8, perimeter: 16, holes: 1, connected: true, centroidEdgeCoast: false, centroidCornerCoast: false, bboxArea: 9 });

const disconnected = cpuFrontierTopology({ parentMask: maskFor([{ x: 0, y: 0 }]), candidateMask: maskFor([{ x: 2, y: 0 }]) });
assert.deepEqual(disconnected.metrics, { area: 2, perimeter: 8, holes: 0, connected: false, centroidEdgeCoast: false, centroidCornerCoast: false, bboxArea: 3 });

const fallback = await createWebGpuFrontierTopology({ gpu: null }).evaluate({ parentMask: maskFor([{ x: 0, y: 0 }]), candidateMask: maskFor([{ x: 1, y: 0 }]) });
assert.equal(fallback.status, 'fallback');
assert.equal(fallback.backend, 'cpu-oracle');
assert.equal(fallback.metrics.area, 2);

const input = { parentMask: maskFor([{ x: 0, y: 0 }]), candidateMask: maskFor([{ x: 1, y: 0 }]) };
const expected = cpuFrontierTopology(input);
const expectedReduction = cpuTopologyReduction(input);
const verified = await createWebGpuFrontierTopology({ accelerator: async () => expectedReduction }).evaluate(input);
assert.equal(verified.status, 'completed');
assert.equal(verified.parity, 'verified');

const rejected = await createWebGpuFrontierTopology({ accelerator: async ({ occupiedMask }) => ({ occupiedMask: [...occupiedMask], area: 1 }) }).evaluate(input);
assert.equal(rejected.status, 'rejected');
assert.equal(rejected.reason, 'topology-parity-mismatch');
assert.deepEqual(rejected.metrics, expected.metrics);

const batch = await createWebGpuFrontierTopology({ accelerator: async () => expectedReduction }).evaluateBatch([input, input]);
assert.equal(batch.status, 'completed');
assert.equal(batch.parity, 'verified');
assert.equal(batch.candidateCount, 2);
assert.equal(batch.results.length, 2);

console.log('WebGPU frontier topology tests passed');
