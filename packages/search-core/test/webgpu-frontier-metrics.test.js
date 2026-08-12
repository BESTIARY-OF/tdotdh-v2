import assert from 'node:assert/strict';
import { createFrontierMetricsCandidate, cpuEvaluateFrontierMetrics, createWebGpuFrontierMetrics, WEBGPU_FRONTIER_METRICS_SCHEMA } from '../src/webgpu-frontier-metrics.js';

const parentCells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
const candidateCells = [{ x: 1, y: 1 }, { x: 2, y: 1 }];
const centroidCells = [{ x: 0, y: 0 }];
const ringCells = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
const bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
const candidate = createFrontierMetricsCandidate({ parentCells, candidateCells, centroidCells, ringCells, bounds });
const cpu = cpuEvaluateFrontierMetrics([candidate]);

assert.equal(cpu.schema, WEBGPU_FRONTIER_METRICS_SCHEMA);
assert.deepEqual(cpu.metrics[0], [2, 1, 0, 2, 3 * 2, 2 * 40000 + 6 * 1000 - 2 * 2400 - 1 * 2000]);

const unavailable = await createWebGpuFrontierMetrics({ gpu: null }).evaluate([candidate]);
assert.equal(unavailable.status, 'unavailable');
assert.deepEqual(unavailable.metrics, cpu.metrics);

const previousBufferUsage = globalThis.GPUBufferUsage, previousMapMode = globalThis.GPUMapMode;
globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, MAP_READ: 16 };
globalThis.GPUMapMode = { READ: 1 };
let createdBuffers = 0, destroyedBuffers = 0, mappedReads = 0;
const fakeDevice = {
  limits: { maxStorageBufferBindingSize: 262144 },
  queue: { writeBuffer() {}, submit() {} },
  createBuffer() { createdBuffers += 1; return { destroy() { destroyedBuffers += 1; }, async mapAsync() { mappedReads += 1; }, getMappedRange() { return Int32Array.from(cpu.metrics[0]).buffer; }, unmap() {} }; },
  createShaderModule() { return {}; },
  createComputePipeline() { return { getBindGroupLayout() { return {}; } }; },
  createBindGroup() { return {}; },
  createCommandEncoder() { return { beginComputePass() { return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }; }, copyBufferToBuffer() {}, finish() { return {}; } }; },
};
const fakeAdapter = { limits: { maxStorageBufferBindingSize: 262144 }, async requestDevice() { return fakeDevice; } };
try {
  const reusable = createWebGpuFrontierMetrics({ gpu: { async requestAdapter() { return fakeAdapter; } } });
  const first = await reusable.evaluate([candidate]);
  const second = await reusable.evaluate([candidate]);
  assert.equal(first.status, 'completed');
  assert.equal(second.status, 'completed');
  assert.equal(first.parity, 'verified');
  assert.deepEqual(second.metrics, cpu.metrics);
  assert.equal(createdBuffers, 7, 'one reusable resource set should serve repeated evaluations');
  assert.equal(destroyedBuffers, 0, 'reusable resources must remain alive between evaluations');
  assert.equal(mappedReads, 2, 'each evaluation must retain its explicit mapAsync result boundary');
} finally {
  if (previousBufferUsage === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage = previousBufferUsage;
  if (previousMapMode === undefined) delete globalThis.GPUMapMode; else globalThis.GPUMapMode = previousMapMode;
}

console.log(JSON.stringify({ schema: cpu.schema, metrics: cpu.metrics, fallback: unavailable.reason }));
