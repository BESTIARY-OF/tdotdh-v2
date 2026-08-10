import assert from 'node:assert/strict';
import { cpuScoreFrontierCandidates, createWebGpuFrontierScorer, DEFAULT_SHADER, WEBGPU_FRONTIER_SCORER_SCHEMA } from '../src/webgpu-frontier-scorer.js';

assert.match(DEFAULT_SHADER, /array<ScoreInput>/);
assert.match(DEFAULT_SHADER, /targetProgress/);
assert.match(DEFAULT_SHADER, /gravityTension/);

const rows = [
  { geometryScore: 12.5, targetProgress: 2, flags: 5, neighborCount: 3, targetNeighborCount: 4, coastBias: 0.2, perimeter: 7, gravityBias: 0.1, gravityTension: 2.5, inletBias: 0.3, inletRisk: 1.2, randomUnit: 0.5 },
  { geometryScore: 5, targetProgress: 0, flags: 10, neighborCount: 2, targetNeighborCount: 2, coastBias: 0, perimeter: 3, gravityBias: 0, gravityTension: 0, inletBias: 0, inletRisk: 0, randomUnit: 0 },
];
const cpu = cpuScoreFrontierCandidates(rows);
assert.equal(cpu.schema, WEBGPU_FRONTIER_SCORER_SCHEMA);
assert.equal(cpu.scores[0], 12.5 - 640 + 80 * 1 + 0.2 * 7 * 2.5 + 0.1 * 2.5 * 0.025 + 0.3 * 1.2 * 5 + 6);
assert.equal(cpu.scores[1], 5 - 220 - 220);
const fallback = await createWebGpuFrontierScorer({ gpu: null }).score(rows);
assert.equal(fallback.status, 'unavailable');
assert.deepEqual(fallback.scores, cpu.scores);
console.log('WebGPU frontier scorer tests passed');
