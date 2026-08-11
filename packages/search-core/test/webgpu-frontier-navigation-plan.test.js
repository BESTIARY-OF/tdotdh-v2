import assert from 'node:assert/strict';
import { createWebGpuFrontierNavigationPlan, createWebGpuFrontierNavigationPlanFromCandidateRecords, createWebGpuFrontierNavigationScheduler, cpuSelectFrontierNavigationRows, decodeWebGpuFrontierNavigationRow, FRONTIER_NAVIGATION_GROUP_STRIDE, FRONTIER_NAVIGATION_PLAN_SHADER, FRONTIER_NAVIGATION_RESIDENT_SHADER, WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA } from '../src/webgpu-frontier-navigation-plan.js';

const rows = [
  { planIndex: 0, targetOrdinal: 1, pieceId: 4, candidateIndex: 0, originX: 2, originY: 3, targetX: 2, targetY: 4 },
  { planIndex: 0, targetOrdinal: 1, pieceId: 5, candidateIndex: 0, originX: 3, originY: 3, targetX: 2, targetY: 4 },
  { planIndex: 0, targetOrdinal: 0, pieceId: 4, candidateIndex: 1, originX: 1, originY: 3, targetX: 1, targetY: 4 },
  { planIndex: 1, targetOrdinal: 0, pieceId: 7, candidateIndex: 0, originX: -1, originY: 2, targetX: -1, targetY: 3 },
];
const plan = createWebGpuFrontierNavigationPlan(rows);
assert.equal(plan.schema, WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA);
assert.equal(plan.rowCount, 4);
assert.equal(plan.stride, 8);
assert.equal(plan.groupStride, FRONTIER_NAVIGATION_GROUP_STRIDE);
assert.equal(plan.groupCount, 3);
assert.ok(plan.groupIndices instanceof Uint32Array);
assert.ok(plan.groupValues instanceof Uint32Array);
assert.match(FRONTIER_NAVIGATION_PLAN_SHADER, /fn choose/);
assert.match(FRONTIER_NAVIGATION_PLAN_SHADER, /fn select/);
assert.match(FRONTIER_NAVIGATION_RESIDENT_SHADER, /fn selectResident/);
assert.match(FRONTIER_NAVIGATION_RESIDENT_SHADER, /fn countResident/);
assert.match(FRONTIER_NAVIGATION_RESIDENT_SHADER, /var<storage, read> validity/);
assert.ok(plan.values instanceof Int32Array);
assert.deepEqual(decodeWebGpuFrontierNavigationRow(plan, 2), rows[2]);
const oracle = cpuSelectFrontierNavigationRows(plan, { planCount: 2 });
assert.deepEqual(Array.from(oracle.selectedRows), [2, 3]);
assert.equal(oracle.recordProtocol, 'tdotdh.webgpu-frontier-record-navigation.v0');
assert.match(oracle.recordInputDigest, /^fnv1a32-[0-9a-f]{8}$/);
const scheduler = createWebGpuFrontierNavigationScheduler({ accelerator: async ({ oracle: expected }) => ({ status: 'completed', selectedRows: expected.selectedRows, dispatch: 'fake-navigation-dispatch' }) });
const verified = await scheduler.select(rows, { planCount: 2 });
assert.equal(verified.backend, 'webgpu');
assert.equal(verified.parity, 'verified');
assert.equal(verified.dispatch, 'fake-navigation-dispatch');
const fallback = await createWebGpuFrontierNavigationScheduler().select(rows, { planCount: 2 });
assert.equal(fallback.backend, 'cpu-oracle');
assert.equal(fallback.parity, 'oracle');
const flat = createWebGpuFrontierNavigationPlanFromCandidateRecords([
  { planIndex: 0, records: [
    { pieceId: 4, targetOrdinal: 1, originX: 2, originY: 3, inputOrdinal: 0 },
    { pieceId: 5, targetOrdinal: 1, originX: 3, originY: 3, inputOrdinal: 1 },
    { pieceId: 4, targetOrdinal: 0, originX: 1, originY: 3, inputOrdinal: 2 },
  ], targetPool: [{ x: 1, y: 4 }, { x: 2, y: 4 }] },
  { planIndex: 1, records: [{ pieceId: 7, targetOrdinal: 0, originX: -1, originY: 2, inputOrdinal: 0 }], targetPool: [{ x: -1, y: 3 }] },
]);
assert.equal(flat.rowCount, 4);
assert.deepEqual(decodeWebGpuFrontierNavigationRow(flat, 0), { planIndex: 0, targetOrdinal: 1, pieceId: 4, candidateIndex: 0, originX: 2, originY: 3, targetX: 2, targetY: 4 });
assert.deepEqual(Array.from(cpuSelectFrontierNavigationRows(flat, { planCount: 2 }).selectedRows), [2, 3]);
assert.equal(cpuSelectFrontierNavigationRows(flat, { planCount: 2 }).recordProtocol, 'tdotdh.webgpu-frontier-record-navigation.v0');
const flatScheduler = createWebGpuFrontierNavigationScheduler({ accelerator: async ({ oracle: expected }) => ({ status: 'completed', selectedRows: expected.selectedRows, dispatch: 'fake-flat-record-dispatch' }) });
const flatReceipt = await flatScheduler.selectCandidateRecords([
  { planIndex: 0, records: [{ pieceId: 4, targetOrdinal: 0, originX: 1, originY: 3, inputOrdinal: 2 }], targetPool: [{ x: 1, y: 4 }] },
  { planIndex: 1, records: [{ pieceId: 7, targetOrdinal: 0, originX: -1, originY: 2, inputOrdinal: 0 }], targetPool: [{ x: -1, y: 3 }] },
], { planCount: 2 });
assert.equal(flatReceipt.backend, 'webgpu');
assert.equal(flatReceipt.parity, 'verified');
assert.equal(flatReceipt.dispatch, 'fake-flat-record-dispatch');
assert.equal(flatReceipt.plan.rowCount, 2);
const residentScheduler = createWebGpuFrontierNavigationScheduler({ accelerator: async ({ oracle: expected }) => ({ status: 'completed', selectedRows: expected.selectedRows, dispatch: 'fake-resident-record-dispatch' }) });
const residentReceipt = await residentScheduler.selectResidentCandidateRecords([
  { residentHandle: { schema: 'tdotdh.webgpu-frontier-candidate-records-resident.v0', recordCount: rows.length, recordsBuffer: {} }, piecePlans: [0, 0, 0, 0, 0, 0, 0, 1] },
], { planCount: 2, expectedRows: rows });
assert.equal(residentReceipt.backend, 'webgpu');
assert.equal(residentReceipt.parity, 'verified');
assert.equal(residentReceipt.dispatch, 'fake-resident-record-dispatch');
assert.deepEqual(Array.from(residentReceipt.selectedRows), [2, 3]);
const targetResidentReceipt = await residentScheduler.selectResidentCandidateRecords([
  { residentHandle: { schema: 'tdotdh.webgpu-frontier-target-records.v0', recordCount: rows.length, recordsBuffer: {}, validityBuffer: {} }, piecePlans: [0, 0, 0, 0, 0, 0, 0, 1] },
], { planCount: 2, expectedRows: rows });
assert.equal(targetResidentReceipt.backend, 'webgpu');
assert.equal(targetResidentReceipt.parity, 'verified');
assert.deepEqual(Array.from(targetResidentReceipt.selectedRows), [2, 3]);
const validityScheduler = createWebGpuFrontierNavigationScheduler({ accelerator: async ({ oracle }) => ({ status: 'completed', selectedRows: Array.from(oracle.selectedRows, index => [0, 1, 3][index]), dispatch: 'fake-resident-validity-dispatch' }) });
const validityReceipt = await validityScheduler.selectResidentCandidateRecords([
  { residentHandle: { schema: 'tdotdh.webgpu-frontier-candidate-records-resident.v0', recordCount: rows.length, recordsBuffer: {} }, piecePlans: [0, 0, 0, 0, 0, 0, 0, 1] },
], { planCount: 2, expectedRows: rows.map((row, index) => ({ ...row, valid: index === 2 ? 0 : 1 })) });
assert.equal(validityReceipt.parity, 'verified');
assert.deepEqual(Array.from(validityReceipt.selectedRows), [0, 1, 3]);

{
  const previousBufferUsage = globalThis.GPUBufferUsage, previousMapMode = globalThis.GPUMapMode;
  globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, MAP_READ: 16 };
  globalThis.GPUMapMode = { READ: 1 };
  let createdBuffers = 0;
  const fakeDevice = {
    queue: { writeBuffer() {}, submit() {}, async onSubmittedWorkDone() {} },
    createBuffer() { createdBuffers += 1; return { destroy() {}, async mapAsync() {}, getMappedRange() { return Uint32Array.from([0, 0, 1, 1]).buffer; }, unmap() {} }; },
    createShaderModule() { return {}; },
    createComputePipeline() { return { getBindGroupLayout() { return {}; } }; },
    createBindGroup() { return {}; },
    createCommandEncoder() { return { beginComputePass() { return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }; }, copyBufferToBuffer() {}, finish() { return {}; } }; },
  };
  const fakeAdapter = { limits: { maxStorageBufferBindingSize: 64 * 1024 * 1024 }, async requestDevice() { return fakeDevice; } };
  const persistentScheduler = createWebGpuFrontierNavigationScheduler({ gpu: { async requestAdapter() { return fakeAdapter; } } });
  const firstPersistent = await persistentScheduler.select(rows, { planCount: 2 });
  const secondPersistent = await persistentScheduler.select(rows, { planCount: 2 });
  assert.equal(firstPersistent.backend, 'webgpu');
  assert.equal(firstPersistent.persistent, true);
  assert.equal(firstPersistent.dispatch, 'webgpu-navigation-plan-resident');
  assert.equal(firstPersistent.dispatchCount, 1);
  assert.equal(secondPersistent.dispatchCount, 2);
  assert.equal(createdBuffers, 7, 'persistent navigation reuses its seven GPU buffers');
  const residentPersistentScheduler = createWebGpuFrontierNavigationScheduler({ gpu: { async requestAdapter() { return fakeAdapter; } } });
  const residentPersistentReceipt = await residentPersistentScheduler.selectResidentCandidateRecords([
    { residentHandle: { schema: 'tdotdh.webgpu-frontier-target-records.v0', device: fakeDevice, recordCount: rows.length, recordsBuffer: fakeDevice.createBuffer(), validityBuffer: fakeDevice.createBuffer() }, piecePlans: [0, 0, 0, 0, 0, 0, 0, 1] },
  ], { planCount: 2, expectedRows: rows });
  assert.equal(residentPersistentReceipt.backend, 'webgpu');
  assert.equal(residentPersistentReceipt.parity, 'verified');
  assert.deepEqual(Array.from(residentPersistentReceipt.selectedRows), [2, 3]);
  const cancelledController = new AbortController();
  cancelledController.abort();
  const cancelled = await persistentScheduler.select(rows, { planCount: 2, signal: cancelledController.signal });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.reason, 'navigation-cancelled');
  if (previousBufferUsage === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage = previousBufferUsage;
  if (previousMapMode === undefined) delete globalThis.GPUMapMode; else globalThis.GPUMapMode = previousMapMode;
}
console.log('WebGPU frontier navigation-plan tests passed');
