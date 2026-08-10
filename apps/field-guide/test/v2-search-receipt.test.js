import assert from 'node:assert/strict';
import { search } from '../product/v2-legacy-search.js';
import { cpuGenerateFrontierCandidates } from '../../../packages/search-core/src/webgpu-frontier-generator.js';

globalThis.postMessage = () => {};

const cells = Array.from({ length: 9 }, (_, index) => ({ x: index % 3, y: Math.floor(index / 3) }));
const pieces = [{ id: 3, cells }, { id: 1, cells }];
const candidatePrefilter = {
  backend: 'test-compute-shader',
  prefilter: async function prefilter(candidates) {
    return {
      status: 'completed',
      backend: this.backend,
      validity: candidates.map(() => 1),
    };
  },
};
const frontierValidator = {
  backend: 'test-frontier-validator',
  validate: async function validate(candidates) {
    return { status: 'completed', backend: this.backend, validity: candidates.map(() => 1) };
  },
};
const frontierEvaluator = {
  backend: 'test-frontier-evaluator',
  evaluate: async function evaluate(candidates) {
    return { status: 'completed', backend: this.backend, parity: 'verified', validity: candidates.map(() => 1), scores: candidates.map(() => 0) };
  },
};
const frontierGenerator = {
  availability: async () => ({ status: 'available', backend: 'webgpu' }),
  generate: async input => {
    const result = cpuGenerateFrontierCandidates(input);
    return { ...result, status: 'completed', backend: 'test-frontier-generator', parity: 'verified' };
  },
};
const result = await search(pieces, [], {
  searchStrategy: 'balanced',
  candidatePrefilter,
  frontierValidator,
  frontierEvaluator,
  frontierGenerator,
});

assert.equal(result.type, 'done');
assert.deepEqual(result.prefilter, { status: 'used', backend: 'test-compute-shader', candidateCount: 6 });
assert.deepEqual(result.frontier, { status: 'used', backend: 'test-frontier-evaluator', parity: 'verified', candidateCount: 6 });
assert.equal(result.frontierGeneration.status, 'used');
assert.equal(result.frontierGeneration.backend, 'test-frontier-generator');
assert.equal(result.frontierGeneration.parity, 'verified');
console.log('v2 product search receipt test passed');
