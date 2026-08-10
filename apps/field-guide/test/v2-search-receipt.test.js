import assert from 'node:assert/strict';
import { search } from '../product/v2-legacy-search.js';

globalThis.postMessage = () => {};

const cells = Array.from({ length: 9 }, (_, index) => ({ x: index % 3, y: Math.floor(index / 3) }));
const pieces = [{ id: 3, cells }, { id: 1, cells }];
const result = await search(pieces, [], {
  searchStrategy: 'balanced',
  candidatePrefilter: {
    prefilter: async candidates => ({
      status: 'completed',
      backend: 'test-compute-shader',
      validity: candidates.map(() => 1),
    }),
  },
});

assert.equal(result.type, 'done');
assert.deepEqual(result.prefilter, { status: 'used', backend: 'test-compute-shader', candidateCount: 3 });
console.log('v2 product search receipt test passed');
