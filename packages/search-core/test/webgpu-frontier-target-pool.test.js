import assert from 'node:assert/strict';
import { cpuGenerateFrontierTargetPool, cpuGenerateFrontierTargetPoolBatch, createWebGpuFrontierTargetPool, DEFAULT_SHADER } from '../src/webgpu-frontier-target-pool.js';

assert.match(DEFAULT_SHADER, /fn parentAt\(/);
assert.match(DEFAULT_SHADER, /fn centroidAt\(/);
assert.doesNotMatch(DEFAULT_SHADER, /fn bitAt\(mask: array<u32>/);

const input = {
  stateId: 'state-1',
  fieldCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  centroidCells: [{ x: 0, y: 0 }],
};
const cpu = cpuGenerateFrontierTargetPool(input);
assert.equal(cpu.schema, 'tdotdh.webgpu-frontier-target-pool.v0');
assert.ok(cpu.frontierCells.some(cell => cell.x === 2 && cell.y === 0));
assert.ok(cpu.ringCells.some(cell => cell.x === -1 && cell.y === 0));
assert.ok(!cpu.frontierCells.some(cell => cell.x === 0 && cell.y === 0));
const batch = cpuGenerateFrontierTargetPoolBatch([input, { ...input, stateId: 'state-2', fieldCells: [{ x: 4, y: 4 }] }]);
assert.deepEqual(batch.items.map(item => item.stateId), ['state-1', 'state-2']);
const fallback = await createWebGpuFrontierTargetPool({ gpu: null }).generateBatch([input]);
assert.equal(fallback.status, 'unavailable');
assert.deepEqual(fallback.items[0].frontierCells, cpu.frontierCells);
assert.deepEqual(fallback.items[0].ringCells, cpu.ringCells);
console.log('WebGPU frontier target-pool tests passed');
