import assert from 'node:assert/strict';
import { createLabeledFrontierStateCandidate, cpuTransitionLabeledFrontierStates } from '../src/webgpu-labeled-frontier-state.js';
import { createWebGpuResidentFrontierState, WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA } from '../src/webgpu-resident-frontier-state.js';

const candidate = createLabeledFrontierStateCandidate({
  pieceIds: [3, 49, 97],
  parentPlacements: [{ id: 3, cells: [{ x: 2, y: 0 }] }, { id: 49, cells: [{ x: 3, y: 0 }] }],
  candidate: { id: 97, cells: [{ x: 2, y: 1 }] },
  remainingIds: [97],
});
const cpu = cpuTransitionLabeledFrontierStates([candidate]);
const previousBufferUsage = globalThis.GPUBufferUsage, previousMapMode = globalThis.GPUMapMode;
globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, MAP_READ: 16 };
globalThis.GPUMapMode = { READ: 1 };
let createdBuffers = 0;
const seedParentWrites = [];
const fakeAdapter = { limits: { maxStorageBufferBindingSize: 64 * 1024 * 1024, maxStorageBuffersPerShaderStage: 16 }, async requestDevice() { return {
  limits: { maxStorageBufferBindingSize: 64 * 1024 * 1024, maxStorageBuffersPerShaderStage: 16 },
  queue: { writeBuffer(buffer, offset, data) { if (buffer?.kind === 'seedParents') seedParentWrites.push({ offset, bytes: data.byteLength }); }, submit() {}, async onSubmittedWorkDone() {} },
  createBuffer() {
    createdBuffers += 1;
    const readbackKind = { 15: cpu.nextLabels, 16: cpu.canonicalLabels, 17: cpu.absoluteHashes, 18: cpu.canonicalHashes }[createdBuffers] || [];
    return { kind: createdBuffers === 1 ? 'seedParents' : undefined, destroy() {}, async mapAsync() {}, getMappedRange() { return Uint32Array.from(readbackKind).buffer; }, unmap() {} };
  },
  createShaderModule() { return {}; },
  createComputePipeline() { return { getBindGroupLayout() { return {}; } }; },
  createBindGroup() { return {}; },
  createCommandEncoder() { return { beginComputePass() { return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }; }, copyBufferToBuffer() {}, finish() { return {}; } }; },
}; } };
try {
  const resident = createWebGpuResidentFrontierState({ gpu: { async requestAdapter() { return fakeAdapter; } }, capacity: 4, batchCapacity: 2 });
  assert.equal((await resident.availability()).status, 'available');
  resident.beginLayer();
  const first = await resident.transition([candidate]);
  assert.equal(first.schema, 'tdotdh.webgpu-labeled-frontier-state.v0');
  assert.equal(first.status, 'completed');
  assert.equal(first.resident, true);
  assert.deepEqual(first.residentStateIndices, [0]);
  assert.equal(first.residentEpoch, 1);
  const committed = resident.commitLayer();
  assert.equal(committed.schema, WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA);
  assert.equal(committed.epoch, 1);
  const child = { ...candidate, parentStateIndex: 0 };
  resident.beginLayer();
  const second = await resident.transition([child]);
  assert.equal(second.status, 'completed');
  assert.equal(second.residentEpoch, 2);
  assert.deepEqual(second.nextLabels, cpu.nextLabels);
  assert.equal(seedParentWrites.length, 1, 'resident child must not re-upload its CPU parent labels');
  assert.equal(createdBuffers, 18, 'resident pool must reuse its double-buffered allocation');
  resident.commitLayer();
  resident.reset();
} finally {
  if (previousBufferUsage === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage = previousBufferUsage;
  if (previousMapMode === undefined) delete globalThis.GPUMapMode; else globalThis.GPUMapMode = previousMapMode;
}

console.log('WebGPU resident frontier state tests passed');
