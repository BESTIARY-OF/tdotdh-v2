import assert from 'node:assert/strict';
import { createFrontierStateCandidate, cpuTransitionFrontierStates, createWebGpuFrontierState, WEBGPU_FRONTIER_STATE_SCHEMA } from '../src/webgpu-frontier-state.js';

const candidate = createFrontierStateCandidate({
  parentCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  candidateCells: [{ x: 0, y: 1 }, { x: 1, y: 1 }],
  remainingIds: [1, 3, 97],
});
const cpu = cpuTransitionFrontierStates([candidate]);

assert.equal(cpu.schema, WEBGPU_FRONTIER_STATE_SCHEMA);
assert.equal(cpu.nextMasks.length, 128);
assert.equal(cpu.canonicalMasks.length, 128);
assert.equal(cpu.hashes.length, 1);
assert.notEqual(cpu.hashes[0], 0);

const unavailable = await createWebGpuFrontierState({ gpu: null }).transition([candidate]);
assert.equal(unavailable.status, 'unavailable');
assert.deepEqual(unavailable.nextMasks, cpu.nextMasks);
assert.deepEqual(unavailable.canonicalMasks, cpu.canonicalMasks);
assert.deepEqual(unavailable.hashes, cpu.hashes);

console.log(JSON.stringify({ schema: cpu.schema, hash: cpu.hashes[0], fallback: unavailable.reason }));
