import assert from 'node:assert/strict';
import { createWebGpuFrontierCandidateRecords, cpuCompactFrontierCandidateRecords } from '../src/webgpu-frontier-candidate-records.js';

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
console.log('WebGPU frontier candidate-record tests passed');

