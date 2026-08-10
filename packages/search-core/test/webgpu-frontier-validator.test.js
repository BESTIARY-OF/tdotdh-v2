import assert from 'node:assert/strict';
import { cpuValidateFrontierCandidates, createWebGpuFrontierValidator, WEBGPU_FRONTIER_VALIDATOR_SCHEMA } from '../src/webgpu-frontier-validator.js';

const empty = new Uint32Array(128);
const parent = [...empty]; parent[0] = 0b0010;
const overlapping = [...empty]; overlapping[0] = 0b0010;
const disjoint = [...empty]; disjoint[0] = 0b0100;

const cpu = cpuValidateFrontierCandidates([
  { parentMask: parent, candidateMask: overlapping, depth: 2, branchCursor: 4, nodeCursor: 9 },
  { parentMask: parent, candidateMask: disjoint, depth: 2, branchCursor: 5, nodeCursor: 10 },
]);
assert.equal(cpu.schema, WEBGPU_FRONTIER_VALIDATOR_SCHEMA);
assert.deepEqual(cpu.validity, [0, 1]);
assert.deepEqual(cpu.acceptedIndices, [1]);

const unavailable = await createWebGpuFrontierValidator({ gpu: null }).availability();
assert.equal(unavailable.status, 'unavailable');
assert.equal(unavailable.backend, 'webgpu');

console.log('WebGPU frontier validator tests passed');
