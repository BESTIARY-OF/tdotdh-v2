import assert from 'node:assert/strict';
import { cpuGenerateFrontierCandidates, createWebGpuFrontierGenerator } from '../src/webgpu-frontier-generator.js';

const input = {
  fieldCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  pieceCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  bounds: { minX: 0, maxX: 1, minY: 0, maxY: 0 },
};
const cpu = cpuGenerateFrontierCandidates(input);
assert.equal(cpu.schema, 'tdotdh.webgpu-frontier-generator.v0');
assert.equal(cpu.candidateCount, 16);
assert.equal(cpu.origins.length, cpu.candidateCount);
assert.equal(cpu.validity.length, cpu.candidateCount);
assert.ok(cpu.acceptedIndices.length > 0);
assert.deepEqual(cpu, cpuGenerateFrontierCandidates(input));

const fallback = await createWebGpuFrontierGenerator({ gpu: null }).generate(input);
assert.equal(fallback.status, 'unavailable');
assert.deepEqual(fallback.origins, cpu.origins);
assert.deepEqual(fallback.validity, cpu.validity);
assert.deepEqual(fallback.acceptedIndices, cpu.acceptedIndices);
console.log(JSON.stringify({ candidateCount: cpu.candidateCount, accepted: cpu.acceptedIndices.length, result: 'passed' }));
