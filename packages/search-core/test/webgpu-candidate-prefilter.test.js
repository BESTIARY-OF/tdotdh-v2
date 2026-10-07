import assert from 'node:assert/strict';
import { cpuCandidatePrefilter, createWebGpuCandidatePrefilter, WEBGPU_CANDIDATE_PREFILTER_SCHEMA } from '../src/webgpu-candidate-prefilter.js';

const candidates = [
  [{ pieceId: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }],
  [{ pieceId: 2, cells: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }],
  [{ pieceId: 3, cells: [{ x: 99, y: 0 }] }],
];
assert.deepEqual(cpuCandidatePrefilter(candidates, { minX: -4, maxX: 4, minY: -4, maxY: 4 }), { validity: [1, 0, 0], acceptedIndices: [0] });
assert.deepEqual((await createWebGpuCandidatePrefilter({ gpu: null }).availability()), {
  schema: WEBGPU_CANDIDATE_PREFILTER_SCHEMA,
  status: 'unavailable',
  backend: 'webgpu',
  reason: 'webgpu-adapter-unavailable',
  bounds: { minX: -32, maxX: 32, minY: -32, maxY: 32 },
});
assert.throws(() => cpuCandidatePrefilter([]), /non-empty/);
assert.throws(() => cpuCandidatePrefilter([[{ x: 0, y: 0 }]], { minX: 2, maxX: 1 }), /ordered/);
console.log('WebGPU candidate prefilter tests passed');
