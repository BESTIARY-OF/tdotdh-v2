import assert from 'node:assert/strict';
import { search } from '../product/v2-legacy-search.js';

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
const result = await search(pieces, [], {
  searchStrategy: 'balanced',
  candidatePrefilter,
  frontierValidator,
});

assert.equal(result.type, 'done');
assert.deepEqual(result.prefilter, { status: 'used', backend: 'test-compute-shader', candidateCount: 3 });
assert.deepEqual(result.frontier, { status: 'used', backend: 'test-frontier-validator', candidateCount: 3 });
console.log('v2 product search receipt test passed');
