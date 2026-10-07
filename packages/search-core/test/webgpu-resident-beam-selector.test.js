import assert from 'node:assert/strict';
import { cpuSelectResidentBeam, cpuSelectResidentScoreInputs, createWebGpuResidentBeamSelector, RESIDENT_BEAM_SCORE_INPUT_SHADER, RESIDENT_BEAM_SCORE_SHADER, RESIDENT_BEAM_SORT_SHADER } from '../src/webgpu-resident-beam-selector.js';

const rows = [{ score: 4, tie: 2 }, { score: 1, tie: 5 }, { score: 1, tie: 1 }, { score: 3, tie: 0 }];
const oracle = cpuSelectResidentBeam(rows, 3);
assert.deepEqual(oracle.indices, [2, 1, 3]);
assert.equal(oracle.algorithm, 'resident-score-rank');
assert.match(RESIDENT_BEAM_SCORE_SHADER, /@compute/);
assert.match(RESIDENT_BEAM_SCORE_INPUT_SHADER, /targetProgress/);
assert.match(RESIDENT_BEAM_SORT_SHADER, /isAfter/);
const unavailable = createWebGpuResidentBeamSelector({ gpu: null });
assert.equal((await unavailable.availability()).status, 'unavailable');
const fallback = await unavailable.select(rows, 2);
assert.equal(fallback.status, 'unavailable');
assert.deepEqual(fallback.indices, [2, 1]);
const scoreInputs = [
  { geometryScore: 4, targetProgress: 0, neighborCount: 2, targetNeighborCount: 2, neighborActive: true, flags: 4 },
  { geometryScore: 1, targetProgress: 0, neighborCount: 1, targetNeighborCount: 2, neighborActive: true, flags: 4 },
  { geometryScore: 2, targetProgress: 0, neighborCount: 2, targetNeighborCount: 2, neighborActive: true, flags: 4 },
];
const scoreOracle = cpuSelectResidentScoreInputs(scoreInputs, 2);
assert.deepEqual(scoreOracle.indices, [2, 0]);
const scoreFallback = await unavailable.selectScoreInputs(scoreInputs, 2);
assert.equal(scoreFallback.status, 'unavailable');
assert.deepEqual(scoreFallback.indices, scoreOracle.indices);
assert.deepEqual(scoreFallback.scores, scoreOracle.scores);
console.log('WebGPU resident beam selector tests passed');
