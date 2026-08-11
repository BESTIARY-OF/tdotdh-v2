import assert from 'node:assert/strict';
import { cpuSelectFrontierRecords, PROTOCOL, selectFrontierRecords, webgpuRecordNavigationAvailability } from '../src/webgpu-frontier-record-navigation.js';

const record = (planIndex, targetOrdinal, pieceId, originX, originY, inputOrdinal) => ({ planIndex, targetOrdinal, pieceId, originX, originY, inputOrdinal });
const records = [
  record(0, 4, 10, 0, 0, 100), record(0, 4, 11, 1, 0, 101), record(0, 2, 12, 2, 0, 102),
  record(1, 5, 20, 0, 1, 103), record(1, 5, 21, 1, 1, 104), record(1, 1, 22, 2, 1, 105), record(1, 1, 23, 3, 1, 106),
];

const oracle = cpuSelectFrontierRecords(records, { capacity: 8 });
assert.equal(oracle.protocol, PROTOCOL);
assert.deepEqual(oracle.selectedInputIndices, [2, 5, 6]);
assert.deepEqual(oracle.selections.map(({ planIndex, targetOrdinal, population }) => ({ planIndex, targetOrdinal, population })), [
  { planIndex: 0, targetOrdinal: 2, population: 1 },
  { planIndex: 1, targetOrdinal: 1, population: 2 },
]);
assert.throws(() => cpuSelectFrontierRecords([{ ...records[0], extra: true }]), /invalid field set/);
assert.throws(() => cpuSelectFrontierRecords([{ ...records[0], originX: 0x80000000 }]), /originX/);
assert.deepEqual(webgpuRecordNavigationAvailability({ gpu: null }), { status: 'unavailable', backend: 'cpu-oracle', reason: 'navigator.gpu is not present' });

const fallback = await selectFrontierRecords(records, { capacity: 8, adapter: { gpu: {} } });
assert.equal(fallback.status, 'fallback');
assert.equal(fallback.backend, 'cpu-oracle');
assert.deepEqual(fallback.selectedInputIndices, oracle.selectedInputIndices);

const used = await selectFrontierRecords(records, {
  capacity: 8,
  adapter: {
    gpu: {},
    adapter: {},
    device: {},
    select: async request => ({ backend: 'test-webgpu', selectedInputIndices: oracle.selectedInputIndices, inputDigest: request.inputDigest }),
  },
});
assert.equal(used.status, 'used');
assert.equal(used.parity, 'verified');
assert.equal(used.backend, 'test-webgpu');
assert.deepEqual(used.selectedInputIndices, oracle.selectedInputIndices);

console.log('WebGPU frontier record navigation tests passed');
