import assert from 'node:assert/strict';
import { cpuCandidateScores, createWebGpuCandidateScorer, WEBGPU_CANDIDATE_SCORER_SCHEMA } from '../src/webgpu-candidate-scorer.js';

const values = [0, 1, 17, 255, 0xffffffff];
assert.deepEqual(cpuCandidateScores(values), [4053965289, 1399529528, 1878230312, 3736530790, 1881533542]);

const scorer = createWebGpuCandidateScorer({ gpu: null });
assert.deepEqual(await scorer.availability(), {
  schema: WEBGPU_CANDIDATE_SCORER_SCHEMA,
  status: 'unavailable',
  backend: 'webgpu',
  reason: 'webgpu-adapter-unavailable',
  requiredLimits: { maxStorageBufferBindingSize: 65536 },
});
assert.equal((await scorer.score(values)).status, 'unavailable');
assert.throws(() => cpuCandidateScores([-1]), /unsigned 32-bit/);
assert.throws(() => createWebGpuCandidateScorer({ shaderSource: '' }), /non-empty/);

console.log('WebGPU candidate scorer tests passed');
