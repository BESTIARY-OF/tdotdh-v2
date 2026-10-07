import assert from 'node:assert/strict';
import { cpuCompactFrontierRows, createWebGpuFrontierCompactor, createWebGpuPersistentFrontierCompactor } from '../src/webgpu-frontier-compactor.js';

const rows = [{ score: 2, tie: 4 }, { score: 1, tie: 9 }, { score: 1, tie: 3 }, { score: 3, tie: 0 }];
const cpu = cpuCompactFrontierRows(rows, 2);
assert.deepEqual(cpu.indices, [2, 1]);
assert.deepEqual(cpu.keep, [0, 1, 1, 0]);
const fallback = await createWebGpuFrontierCompactor({ gpu: null }).compact(rows, 2);
assert.equal(fallback.status, 'unavailable');
assert.deepEqual(fallback.indices, cpu.indices);
assert.deepEqual(fallback.keep, cpu.keep);
const persistent = createWebGpuPersistentFrontierCompactor({ gpu: null, capacity: 8 });
const persistentFallback = await persistent.compact(rows, 2);
assert.equal(persistentFallback.status, 'unavailable');
assert.equal(persistentFallback.persistent, true);
assert.equal(persistentFallback.bufferCapacity, 8);
assert.deepEqual(persistentFallback.indices, cpu.indices);
persistent.reset();

const priorBufferUsage = globalThis.GPUBufferUsage, priorMapMode = globalThis.GPUMapMode;
globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, MAP_READ: 16 };
globalThis.GPUMapMode = { READ: 1 };
let createdBuffers = 0;
const fakeReadback = { destroy() {}, async mapAsync() {}, getMappedRange() { const bytes = new ArrayBuffer(32), view = new DataView(bytes); view.setUint32(8, 2, true); view.setUint32(24, 1, true); return bytes; }, unmap() {} };
const fakeAdapter = { limits: { maxComputeWorkgroupSizeX: 64 }, async requestDevice() { return {
  limits: { maxStorageBufferBindingSize: 1024 * 1024, maxBufferSize: 1024 * 1024 },
  queue: { writeBuffer() {}, submit() {}, async onSubmittedWorkDone() {} },
  createBuffer() { createdBuffers++; return createdBuffers === 4 ? fakeReadback : { destroy() {} }; },
  createShaderModule() { return {}; },
  createComputePipeline() { return { getBindGroupLayout() { return {}; } }; },
  createBindGroup() { return {}; },
  createCommandEncoder() { return { beginComputePass() { return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }; }, copyBufferToBuffer() {}, finish() { return {}; } }; },
}; } };
const fakeGpu = { async requestAdapter() { return fakeAdapter; } };
try {
  const persistentGpu = createWebGpuPersistentFrontierCompactor({ gpu: fakeGpu, capacity: 8 });
  const first = await persistentGpu.compact(rows, 2), second = await persistentGpu.compact(rows, 2);
  assert.equal(first.status, 'completed');
  assert.equal(first.parity, 'verified');
  assert.equal(first.persistent, true);
  assert.deepEqual(second.indices, cpu.indices);
  assert.equal(createdBuffers, 4, 'persistent compactor must reuse its four device buffers');
  persistentGpu.reset();
} finally {
  if (priorBufferUsage === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage = priorBufferUsage;
  if (priorMapMode === undefined) delete globalThis.GPUMapMode; else globalThis.GPUMapMode = priorMapMode;
}
console.log('WebGPU frontier compactor tests passed');
