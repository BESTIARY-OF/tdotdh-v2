import assert from 'node:assert/strict';
import { createLabeledFrontierStateCandidate } from '../src/webgpu-labeled-frontier-state.js';
import { createWebGpuResidentFrontierState } from '../src/webgpu-resident-frontier-state.js';

const previousBufferUsage = globalThis.GPUBufferUsage, previousMapMode = globalThis.GPUMapMode;
globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, MAP_READ: 16 };
globalThis.GPUMapMode = { READ: 1 };
let bufferId = 0;
const writes = [];
let specializedShader = '';
const fakeDevice = {
  queue: {
    writeBuffer(buffer, offset, data) { writes.push({ buffer, offset, length: data.length }); },
    submit() { throw new Error('stop-after-dispatch'); },
    async onSubmittedWorkDone() {},
  },
  createBuffer() { return { id: ++bufferId, destroy() {}, async mapAsync() {}, getMappedRange() { return new ArrayBuffer(0); }, unmap() {} }; },
  createShaderModule({ code }) { specializedShader = code; return {}; },
  createComputePipeline() { return { getBindGroupLayout() { return {}; } }; },
  createBindGroup() { return {}; },
  createCommandEncoder() { return { beginComputePass() { return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }; }, copyBufferToBuffer() {}, finish() { return {}; } }; },
};
const fakeAdapter = { limits: { maxStorageBufferBindingSize: 64 * 1024 * 1024, maxStorageBuffersPerShaderStage: 14 }, async requestDevice() { return fakeDevice; } };
const grid = { width: 33, height: 2, originX: 0, originY: 0 };
const rootCandidates = [
  createLabeledFrontierStateCandidate({ pieceIds: [1, 2], parentPlacements: [], candidate: { id: 1, cells: [{ x: 0, y: 0 }] }, remainingIds: [2] }, grid),
  createLabeledFrontierStateCandidate({ pieceIds: [1, 2], parentPlacements: [], candidate: { id: 2, cells: [{ x: 1, y: 0 }] }, remainingIds: [1] }, grid),
];

try {
  const resident = createWebGpuResidentFrontierState({ gpu: { async requestAdapter() { return fakeAdapter; } }, grid, capacity: 4, batchCapacity: 2 });
  const result = await resident.transition(rootCandidates);
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /stop-after-dispatch/);
  assert.match(specializedShader, /if \(id\.x >= params\.candidateCount\)/);
  assert.match(specializedShader, /let labelStride = 3u/);
  assert.match(specializedShader, /let labelsPerState = 2u \* labelStride/);
  assert.match(specializedShader, /for \(var y: u32 = 0u; y < 2u;/);
  const seedParentBuffer = 1;
  assert.deepEqual(writes.filter(write => write.buffer.id === seedParentBuffer).map(write => write.offset), [0, 24]);
} finally {
  if (previousBufferUsage === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage = previousBufferUsage;
  if (previousMapMode === undefined) delete globalThis.GPUMapMode; else globalThis.GPUMapMode = previousMapMode;
}

console.log('WebGPU resident frontier state contract tests passed');
