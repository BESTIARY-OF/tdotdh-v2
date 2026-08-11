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
const residentFallback = await adapter.generateBatchResident([{ pieceId: 'a', ...input }]);
assert.equal(residentFallback.status, 'unavailable');
assert.equal(residentFallback.readback, 'cpu-fallback');
assert.deepEqual(residentFallback.items[0].validity, single.validity);
const cancelledBeforeDispatch = await adapter.generateBatchResident([{ pieceId: 'a', ...input }], { isCancelled: () => true });
assert.equal(cancelledBeforeDispatch.status, 'cancelled');
assert.equal(cancelledBeforeDispatch.parity, 'deferred');
assert.equal(cancelledBeforeDispatch.readback, 'deferred');

{
  const previousBufferUsage = globalThis.GPUBufferUsage, previousMapMode = globalThis.GPUMapMode;
  globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, MAP_READ: 16 };
  globalThis.GPUMapMode = { READ: 1 };
  let createdBuffers = 0, mappedReads = 0;
  const fakeDevice = {
    queue: { writeBuffer() {}, submit() {}, async onSubmittedWorkDone() {} },
    createBuffer() {
      const index = ++createdBuffers;
      return { destroy() {}, async mapAsync() { mappedReads += 1; }, getMappedRange() {
        if (index === 10) return Int32Array.from([1, 0, 0, 0, 0, 1, -1, 1]).buffer;
        if (index === 11) return Uint32Array.from([1, 0, 1, 1]).buffer;
        return Uint32Array.from([1, 0, 1, 1]).buffer;
      }, unmap() {} };
    },
    createShaderModule() { return {}; },
    createComputePipeline() { return { getBindGroupLayout() { return {}; } }; },
    createBindGroup() { return {}; },
    createCommandEncoder() { return { beginComputePass() { return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }; }, copyBufferToBuffer() {}, finish() { return {}; } }; },
  };
  const fakeAdapter = { limits: { maxStorageBufferBindingSize: 64 * 1024 * 1024 }, async requestDevice() { return fakeDevice; } };
  const persistentGenerator = createWebGpuFrontierTargetGenerator({ gpu: { async requestAdapter() { return fakeAdapter; } } });
  const firstPersistent = await persistentGenerator.generateBatch([{ pieceId: 'a', ...input }]);
  const secondPersistent = await persistentGenerator.generateBatch([{ pieceId: 'a', ...input }]);
  assert.equal(firstPersistent.backend, 'webgpu');
  assert.equal(firstPersistent.parity, 'verified');
  assert.equal(firstPersistent.persistent, true);
  assert.equal(firstPersistent.dispatch, 'webgpu-frontier-target-resident');
  assert.equal(firstPersistent.dispatchCount, 1);
  assert.equal(firstPersistent.residentHandle.schema, 'tdotdh.webgpu-frontier-target-records.v0');
  assert.equal(firstPersistent.residentHandle.recordCount, 4);
  assert.equal(firstPersistent.residentHandle.targetCellsBuffer != null, true);
  assert.equal(firstPersistent.residentHandle.itemMetadata[0].targetOffset, 0);
  assert.equal(secondPersistent.dispatchCount, 2);
  const mappedBeforeResident = mappedReads;
  const residentBatch = await persistentGenerator.generateBatchResident([{ pieceId: 'a', ...input }]);
  assert.equal(residentBatch.backend, 'webgpu');
  assert.equal(residentBatch.parity, 'deferred');
  assert.equal(residentBatch.readback, 'deferred');
  assert.equal(residentBatch.dispatchCount, 3);
  assert.equal(residentBatch.residentHandle.recordCount, 4);
  assert.equal(residentBatch.items[0].candidateCount, 4, 'resident mode returns GPU record metadata without CPU candidate reconstruction');
  assert.equal('validity' in residentBatch.items[0], false, 'resident mode does not materialize intermediate validity rows');
  assert.equal(mappedReads, mappedBeforeResident, 'resident target generation does not map intermediate GPU rows');
  const mappedBeforeBoundary = mappedReads;
  const boundaryBatch = await persistentGenerator.generateBatchResident([{ pieceId: 'a', ...input }], { verifyParity: true });
  assert.equal(boundaryBatch.backend, 'webgpu');
  assert.equal(boundaryBatch.parity, 'verified');
  assert.equal(boundaryBatch.readback, 'result-boundary');
  assert.equal(boundaryBatch.residentHandle.recordCount, 4);
  assert.ok(mappedReads > mappedBeforeBoundary, 'result-boundary parity maps the GPU validity/origin batch');
  assert.equal(createdBuffers, 20, 'persistent target generation reuses its twelve working buffers and snapshots each resident batch');
  if (previousBufferUsage === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage = previousBufferUsage;
  if (previousMapMode === undefined) delete globalThis.GPUMapMode; else globalThis.GPUMapMode = previousMapMode;
}
console.log('WebGPU frontier target generator tests passed');
