import assert from 'node:assert/strict';
import { createWebGpuFrontierCandidateRecords, cpuCompactFrontierCandidateRecords, FRONTIER_CANDIDATE_RECORD_SCAN_SHADER, FRONTIER_CANDIDATE_RECORD_COMPACT_SHADER } from '../src/webgpu-frontier-candidate-records.js';

assert.match(FRONTIER_CANDIDATE_RECORD_SCAN_SHADER, /groupTotals/);
assert.match(FRONTIER_CANDIDATE_RECORD_COMPACT_SHADER, /outputRecords/);

const records = [
  { pieceId: 4, targetOrdinal: 2, originX: -3, originY: 7, inputOrdinal: 0 },
  { pieceId: 4, targetOrdinal: 2, originX: -3, originY: 7, inputOrdinal: 1 },
  { pieceId: 9, targetOrdinal: 2, originX: 0, originY: 0, inputOrdinal: 2 },
  { pieceId: 4, targetOrdinal: 2, originX: 8, originY: 7, inputOrdinal: 3 },
  { pieceId: 9, targetOrdinal: 2, originX: 0, originY: 0, inputOrdinal: 4 },
];
const oracle = cpuCompactFrontierCandidateRecords(records);
assert.equal(oracle.outputCount, 3);
assert.deepEqual(oracle.records, [records[0], records[2], records[3]]);
assert.throws(() => cpuCompactFrontierCandidateRecords([{ ...records[0], gpuHandle: {} }]), /invalid shape/);
assert.throws(() => cpuCompactFrontierCandidateRecords([{ ...records[0], originX: 1.5 }]), /originX/);
const adapter = createWebGpuFrontierCandidateRecords({ gpu: {} });
const receipt = await adapter.compact(records);
assert.equal(receipt.status, 'unavailable');
assert.equal(receipt.backend, 'webgpu');
assert.deepEqual(receipt.records, oracle.records);

{
  const previousBufferUsage = globalThis.GPUBufferUsage, previousMapMode = globalThis.GPUMapMode;
  globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, MAP_READ: 16 };
  globalThis.GPUMapMode = { READ: 1 };
  let createdBuffers = 0;
  const fakeDevice = {
    queue: { writeBuffer() {}, submit() {}, async onSubmittedWorkDone() {} },
    createBuffer() {
      const index = ++createdBuffers;
      return { destroy() {}, async mapAsync() {}, getMappedRange() {
        if (index === 10) return Uint32Array.from([3]).buffer;
        if (index === 11) return Int32Array.from([4, 2, -3, 7, 0, 9, 2, 0, 0, 2, 4, 2, 8, 7, 3]).buffer;
        return new ArrayBuffer(64);
      }, unmap() {} };
    },
    createShaderModule() { return {}; },
    createComputePipeline() { return { getBindGroupLayout() { return {}; } }; },
    createBindGroup() { return {}; },
    createCommandEncoder() { return { beginComputePass() { return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }; }, copyBufferToBuffer() {}, finish() { return {}; } }; },
  };
  const fakeAdapter = { limits: { maxComputeWorkgroupSizeX: 64 }, async requestDevice() { return fakeDevice; } };
  const persistentGenerator = createWebGpuFrontierCandidateRecords({ gpu: { async requestAdapter() { return fakeAdapter; } } });
  const firstPersistent = await persistentGenerator.compact(records);
  const secondPersistent = await persistentGenerator.compact(records);
  assert.equal(firstPersistent.backend, 'webgpu');
  assert.equal(firstPersistent.parity, 'verified');
  assert.equal(firstPersistent.persistent, true);
  assert.equal(firstPersistent.dispatch, 'webgpu-frontier-record-compaction-resident');
  assert.equal(firstPersistent.dispatchCount, 1);
  assert.equal(secondPersistent.dispatchCount, 2);
  assert.equal(createdBuffers, 11, 'persistent candidate compaction reuses its eleven GPU buffers');
  const residentHandle = { schema: 'tdotdh.webgpu-frontier-target-records.v0', device: fakeDevice, recordsBuffer: fakeDevice.createBuffer(), validityBuffer: fakeDevice.createBuffer(), recordCount: records.length };
  const residentReceipt = await persistentGenerator.compactResident(residentHandle, { expectedRecords: records });
  assert.equal(residentReceipt.status, 'completed');
  assert.equal(residentReceipt.parity, 'verified');
  assert.equal(residentReceipt.persistent, true);
  assert.equal(residentReceipt.dispatchCount, 3);
  assert.equal(residentReceipt.residentHandle.schema, 'tdotdh.webgpu-frontier-candidate-records-resident.v0');
  assert.equal(residentReceipt.residentHandle.recordCount, 3);
  if (previousBufferUsage === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage = previousBufferUsage;
  if (previousMapMode === undefined) delete globalThis.GPUMapMode; else globalThis.GPUMapMode = previousMapMode;
}
console.log('WebGPU frontier candidate-record tests passed');
