import assert from 'node:assert/strict';
import { cpuSelectResidentBeam, createWebGpuResidentBeamSelector, RESIDENT_BEAM_SCORE_SHADER, RESIDENT_BEAM_SORT_SHADER } from '../src/webgpu-resident-beam-selector.js';

const rows = [{ score: 4, tie: 2 }, { score: 1, tie: 5 }, { score: 1, tie: 1 }, { score: 3, tie: 0 }];
const oracle = cpuSelectResidentBeam(rows, 3);
assert.deepEqual(oracle.indices, [2, 1, 3]);
assert.equal(oracle.algorithm, 'resident-score-rank');
assert.match(RESIDENT_BEAM_SCORE_SHADER, /@compute/);
assert.match(RESIDENT_BEAM_SORT_SHADER, /isAfter/);
const unavailable = createWebGpuResidentBeamSelector({ gpu: null });
assert.equal((await unavailable.availability()).status, 'unavailable');
const fallback = await unavailable.select(rows, 2);
assert.equal(fallback.status, 'unavailable');
assert.deepEqual(fallback.indices, [2, 1]);
console.log('WebGPU resident beam selector tests passed');
