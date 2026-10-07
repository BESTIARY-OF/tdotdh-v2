import assert from 'node:assert/strict';
import {
  createFrontierEvaluationCandidate,
  createWebGpuFrontierEvaluator,
  cpuEvaluateFrontierCandidates,
} from '../src/webgpu-frontier-evaluator.js';

const terms = [1, 2, 3, 4, 5, 6, 7, 8];
const candidates = [
  createFrontierEvaluationCandidate({ parentCells: [{ x: 0, y: 0 }], candidateCells: [{ x: 1, y: 0 }], scoreTerms: terms }),
  createFrontierEvaluationCandidate({ parentCells: [{ x: 0, y: 0 }], candidateCells: [{ x: 0, y: 0 }], scoreTerms: terms.map(value => -value) }),
];

const cpu = cpuEvaluateFrontierCandidates(candidates);
assert.deepEqual(cpu.validity, [1, 0]);
assert.deepEqual(cpu.scores, [36, -36]);
assert.deepEqual(cpu.acceptedIndices, [0]);

const unavailable = createWebGpuFrontierEvaluator({ gpu: null });
const fallback = await unavailable.evaluate(candidates);
assert.equal(fallback.status, 'unavailable');
assert.deepEqual(fallback.validity, cpu.validity);
assert.deepEqual(fallback.scores, cpu.scores);

console.log('WebGPU frontier evaluator tests passed');
