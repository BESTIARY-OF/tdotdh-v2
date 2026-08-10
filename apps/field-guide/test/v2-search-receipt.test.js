import assert from 'node:assert/strict';
import { search } from '../product/v2-legacy-search.js';
import { cpuGenerateFrontierCandidates } from '../../../packages/search-core/src/webgpu-frontier-generator.js';
import { cpuTransitionLabeledFrontierStates } from '../../../packages/search-core/src/webgpu-labeled-frontier-state.js';
import { cpuFrontierTopology } from '../../../packages/search-core/src/webgpu-frontier-topology.js';
import { cpuEvaluateFieldMetrics } from '../../../packages/search-core/src/webgpu-field-metrics.js';

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
const frontierState = {
  transition: async candidates => ({ ...cpuTransitionLabeledFrontierStates(candidates), backend: 'test-frontier-state', parity: 'verified' }),
};
const fieldMetrics = {
  evaluate: async candidates => ({ ...cpuEvaluateFieldMetrics(candidates), backend: 'test-field-metrics', parity: 'verified' }),
};
const frontierTopology = {
  evaluate: async input => ({ ...cpuFrontierTopology(input), backend: 'test-frontier-topology', parity: 'verified' }),
};
const result = await search(pieces, [], {
  searchStrategy: 'balanced',
  candidatePrefilter,
  frontierValidator,
  frontierEvaluator,
  frontierGenerator,
  frontierState,
  frontierTopology,
  fieldMetrics,
});

assert.equal(result.type, 'done');
assert.deepEqual(result.prefilter, { status: 'used', backend: 'test-compute-shader', candidateCount: 6 });
assert.deepEqual(result.frontier, { status: 'used', backend: 'test-frontier-evaluator', parity: 'verified', candidateCount: 6 });
assert.equal(result.frontierGeneration.status, 'used');
assert.equal(result.frontierGeneration.backend, 'test-frontier-generator');
assert.equal(result.frontierGeneration.parity, 'verified');
assert.equal(result.frontierState.status, 'used');
assert.equal(result.frontierState.backend, 'test-frontier-state');
assert.equal(result.frontierState.finalCanonicalParity, 'verified');
assert.equal(result.frontierTopology.status, 'used');
assert.equal(result.frontierTopology.backend, 'test-frontier-topology');
assert.equal(result.fieldMetrics.status, 'used');
assert.equal(result.fieldMetrics.backend, 'test-field-metrics');
console.log('v2 product search receipt test passed');
