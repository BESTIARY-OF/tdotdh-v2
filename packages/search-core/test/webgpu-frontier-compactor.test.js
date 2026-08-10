import assert from 'node:assert/strict';
import { cpuCompactFrontierRows, createWebGpuFrontierCompactor } from '../src/webgpu-frontier-compactor.js';

const rows = [{ score: 2, tie: 4 }, { score: 1, tie: 9 }, { score: 1, tie: 3 }, { score: 3, tie: 0 }];
const cpu = cpuCompactFrontierRows(rows, 2);
assert.deepEqual(cpu.indices, [2, 1]);
assert.deepEqual(cpu.keep, [0, 1, 1, 0]);
const fallback = await createWebGpuFrontierCompactor({ gpu: null }).compact(rows, 2);
assert.equal(fallback.status, 'unavailable');
assert.deepEqual(fallback.indices, cpu.indices);
assert.deepEqual(fallback.keep, cpu.keep);
console.log('WebGPU frontier compactor tests passed');
