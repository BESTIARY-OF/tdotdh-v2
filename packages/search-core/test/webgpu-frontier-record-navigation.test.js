import assert from 'node:assert/strict';
import {
  createFrontierRecordNavigationAdapter,
  cpuSelectFrontierRecordIndices,
  FRONTIER_RECORD_NAVIGATION_STRIDE,
  packFrontierRecords,
  WEBGPU_FRONTIER_RECORD_NAVIGATION_SCHEMA,
} from '../src/webgpu-frontier-record-navigation.js';

const record = (planIndex, targetOrdinal, pieceId, originX, originY, inputOrdinal) => ({ planIndex, targetOrdinal, pieceId, originX, originY, inputOrdinal });
const records = [
  record(0, 4, 10, 0, 0, 100),
  record(0, 4, 11, 1, 0, 101),
  record(0, 2, 12, 2, 0, 102),
  record(0, 1, 13, 3, 0, 103),
  record(1, 5, 20, 0, 1, 104),
  record(1, 5, 21, 1, 1, 105),
  record(1, 1, 22, 2, 1, 106),
  record(1, 1, 23, 3, 1, 107),
];

const packed = packFrontierRecords(records, { capacity: 8 });
assert.equal(packed.schema, WEBGPU_FRONTIER_RECORD_NAVIGATION_SCHEMA);
assert.equal(packed.stride, FRONTIER_RECORD_NAVIGATION_STRIDE);
assert.equal(packed.recordCount, records.length);
assert.ok(packed.values instanceof Int32Array);
assert.deepEqual(Array.from(packed.values.slice(0, FRONTIER_RECORD_NAVIGATION_STRIDE)), [0, 4, 10, 0, 0, 100]);

const oracle = cpuSelectFrontierRecordIndices(records, { capacity: 8, planCount: 2 });
assert.deepEqual(Array.from(oracle.selectedRecordIndices), [3, 6, 7]);
assert.deepEqual(oracle.selections.map(({ planIndex, targetOrdinal, population }) => ({ planIndex, targetOrdinal, population })), [
  { planIndex: 0, targetOrdinal: 1, population: 1 },
  { planIndex: 1, targetOrdinal: 1, population: 2 },
]);
assert.deepEqual(oracle.selectedRecords.map(value => value.pieceId), [13, 22, 23]);

assert.throws(() => packFrontierRecords([{ ...records[0], extra: true }]), /invalid field set/);
assert.throws(() => packFrontierRecords([{ ...records[0], originX: 0x80000000 }]), /originX/);
assert.throws(() => cpuSelectFrontierRecordIndices([record(2, 0, 1, 0, 0, 0)], { planCount: 2 }), /planIndex/);

const expandedRecords = Array.from({ length: 16385 }, (_, inputOrdinal) => record(0, inputOrdinal % 2, inputOrdinal + 1, inputOrdinal, 0, inputOrdinal));
const expandedOracle = cpuSelectFrontierRecordIndices(expandedRecords, { planCount: 1 });
assert.equal(expandedOracle.recordCount, expandedRecords.length);
assert.equal(expandedOracle.selectedRecordIndices.length, 8192);

const adapter = createFrontierRecordNavigationAdapter({
  accelerator: async request => {
    assert.equal(request.schema, WEBGPU_FRONTIER_RECORD_NAVIGATION_SCHEMA);
    assert.equal(request.stride, FRONTIER_RECORD_NAVIGATION_STRIDE);
    assert.ok(request.packedRecords instanceof Int32Array);
    assert.equal(request.recordCount, records.length);
    return { backend: 'test-gpu', dispatch: 'packed-record-selector', selectedRecordIndices: oracle.selectedRecordIndices };
  },
});
const verified = await adapter.select(records, { planCount: 2 });
assert.equal(verified.status, 'used');
assert.equal(verified.backend, 'test-gpu');
assert.equal(verified.parity, 'verified');
assert.equal(verified.dispatch, 'packed-record-selector');
assert.deepEqual(Array.from(verified.selectedRecordIndices), [3, 6, 7]);

const mismatchAdapter = createFrontierRecordNavigationAdapter({
  accelerator: async () => ({ selectedRecordIndices: [0] }),
});
const mismatch = await mismatchAdapter.select(records, { planCount: 2 });
assert.equal(mismatch.status, 'fallback');
assert.equal(mismatch.backend, 'cpu-oracle');
assert.equal(mismatch.reason, 'record-navigation-oracle-parity-mismatch');
assert.deepEqual(Array.from(mismatch.selectedRecordIndices), [3, 6, 7]);

const unavailable = await createFrontierRecordNavigationAdapter().select(records, { planCount: 2 });
assert.equal(unavailable.status, 'fallback');
assert.equal(unavailable.reason, 'record-navigation-accelerator-unavailable');
assert.deepEqual(Array.from(unavailable.selectedRecordIndices), [3, 6, 7]);

console.log('WebGPU frontier record navigation tests passed');
