import assert from 'node:assert/strict';
import { createNavigationCoordinator, NAVIGATION_COORDINATOR_SCHEMA } from '../src/navigation-coordinator.js';

const ticket = { presetFingerprint: 'preset-v0', familyId: 'F-0RHDG0U', pass: 2, threadId: 7 };
const checkpoint = { schema: 'test.checkpoint.v0', depth: 2, beam: [{ placements: [{ id: 3, cells: [{ x: 0, y: 0 }] }] }] };
const coordinator = createNavigationCoordinator({ ticket, cursor: { depth: 1, nodeOffset: 10, rootChoice: 4 } });
coordinator.observeProgress({ depth: 2, nodeOffset: 15, rootChoice: 4, checkpoint });
const receipt = coordinator.complete({ placements: [{ id: 3, cells: [{ x: 4, y: 6 }] }] });
assert.equal(receipt.schema, NAVIGATION_COORDINATOR_SCHEMA);
assert.equal(receipt.status, 'completed');
assert.equal(receipt.canonicalReplay, 'verified');
assert.equal(receipt.cursor.checkpoint.schema, checkpoint.schema);
assert.equal(receipt.ticket.threadId, 7);
const batch = coordinator.beginBatch({ stage: 'frontier-expansion', depth: 2, nodeOffset: 15, candidateCount: 16 });
assert.equal(batch.ordinal, 0);
assert.equal(batch.backend, 'webgpu');
assert.equal(batch.ownership, 'gpu-first');
assert.equal(batch.ticket.batchOrdinal, 0);
assert.equal(batch.ticket.stage, 'frontier-expansion');
assert.equal(batch.cursor.depth, 2);
const gpuReceipt = coordinator.complete({
  placements: [{ id: 3, cells: [{ x: 4, y: 6 }] }],
  gpuExecution: { deviceAvailable: true },
  frontierTargetGeneration: { status: 'used', backend: 'webgpu', parity: 'verified' },
  frontierState: { status: 'used', backend: 'webgpu', parity: 'verified' },
});
assert.equal(gpuReceipt.expansionBackend, 'webgpu');
assert.equal(gpuReceipt.expansionParity, 'verified');
assert.equal(gpuReceipt.expansionOwnership, 'gpu-owned');
assert.equal(gpuReceipt.gpuExpansionComplete, true);
assert.deepEqual(gpuReceipt.gpuStages, ['frontierTargetGeneration', 'frontierState']);
assert.deepEqual(gpuReceipt.cpuFallbackStages, []);
assert.equal(gpuReceipt.gpuExpansionBatches, 1);
const topologyReceipt = coordinator.complete({
  placements: [{ id: 3, cells: [{ x: 4, y: 6 }] }],
  gpuExecution: { deviceAvailable: true },
  frontierTargetGeneration: { status: 'used', backend: 'webgpu', parity: 'verified' },
  frontierState: { status: 'used', backend: 'webgpu', parity: 'verified' },
  frontierTopology: { status: 'used', backend: 'webgpu', parity: 'labels-verified' },
});
assert.equal(topologyReceipt.expansionOwnership, 'gpu-owned');
assert.equal(topologyReceipt.gpuExpansionComplete, true);
assert.ok(topologyReceipt.gpuStages.includes('frontierTopology'));
assert.deepEqual(topologyReceipt.cpuFallbackStages, []);
const boundaryReceipt = coordinator.complete({
  placements: [{ id: 3, cells: [{ x: 4, y: 6 }] }],
  gpuExecution: { deviceAvailable: true },
  frontierTargetGeneration: { status: 'completed', backend: 'webgpu', parity: 'verified' },
  frontierState: { status: 'completed', backend: 'webgpu', parity: 'verified' },
});
assert.equal(boundaryReceipt.expansionOwnership, 'gpu-owned');
assert.equal(boundaryReceipt.gpuExpansionComplete, true);
assert.deepEqual(boundaryReceipt.gpuStages, ['frontierTargetGeneration', 'frontierState']);
assert.deepEqual(boundaryReceipt.cpuFallbackStages, []);
const controlPlaneReceipt = coordinator.complete({
  placements: [{ id: 3, cells: [{ x: 4, y: 6 }] }],
  gpuExecution: { deviceAvailable: true },
  frontierTargetGeneration: { status: 'resident', backend: 'webgpu', parity: 'deferred' },
  frontierTargetPool: { status: 'skipped', backend: 'cpu-control', parity: 'structural', reason: 'redundant-with-gpu-target-generation-input' },
  frontierState: { status: 'used', backend: 'webgpu', parity: 'verified' },
});
assert.equal(controlPlaneReceipt.expansionOwnership, 'gpu-owned');
assert.equal(controlPlaneReceipt.gpuExpansionComplete, true);
assert.deepEqual(controlPlaneReceipt.cpuFallbackStages, []);
const gatedFallback = coordinator.complete({
  placements: [{ id: 3, cells: [{ x: 4, y: 6 }] }],
  gpuExecution: { deviceAvailable: false, reason: 'webgpu-adapter-unavailable' },
  frontierTargetGeneration: { status: 'used', backend: 'webgpu', parity: 'verified' },
  frontierState: { status: 'fallback', backend: 'cpu-oracle', parity: 'oracle' },
});
assert.equal(gatedFallback.gpuExpansionComplete, false);
assert.equal(gatedFallback.expansionOwnership, 'cpu-oracle-fallback');
assert.equal(gatedFallback.gpuExecution.reason, 'webgpu-adapter-unavailable');
assert.deepEqual(gatedFallback.cpuFallbackStages, ['frontierState']);
assert.deepEqual(coordinator.observeCancellation(false), { checked: true, cancelled: false, count: 1, cursor: coordinator.cursor() });
assert.throws(() => coordinator.observeProgress({ depth: 1, nodeOffset: 16, rootChoice: 4 }), /depth cannot move backward/);
assert.throws(() => coordinator.observeProgress({ depth: 3, nodeOffset: 16, rootChoice: 5 }), /rootChoice cannot change/);
console.log('navigation coordinator tests passed');
