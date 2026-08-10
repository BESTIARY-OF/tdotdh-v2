import assert from 'node:assert/strict';
import { cpuRankFrontierRows, createWebGpuFrontierRanker } from '../src/webgpu-frontier-ranker.js';

const rows = [{ score: 2, tie: 4 }, { score: 1, tie: 9 }, { score: 1, tie: 3 }, { score: 3, tie: 0 }];
const cpu = cpuRankFrontierRows(rows);
assert.deepEqual(cpu.indices, [2, 1, 0, 3]);
const fallback = await createWebGpuFrontierRanker({ gpu: null }).rank(rows);
assert.equal(fallback.status, 'unavailable');
assert.deepEqual(fallback.indices, cpu.indices);
const largeRows = Array.from({ length: 129 }, (_, index) => ({ score: 129 - index, tie: index }));
const largeFallback = await createWebGpuFrontierRanker({ gpu: null }).rank(largeRows);
assert.equal(largeFallback.rowCount, 129);
assert.equal(largeFallback.indices.length, 129);
console.log('WebGPU frontier ranker tests passed');
