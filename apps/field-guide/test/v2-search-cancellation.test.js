import assert from 'node:assert/strict';
import { search } from '../product/v2-legacy-search.js';

const cell = [{ x: 0, y: 0 }];
const pieces = [{ id: 3, cells: cell }, { id: 1, cells: cell }, { id: 2, cells: cell }];
let checks = 0;
const result = await search(pieces, [], {
  searchStrategy: 'depth',
  reportProgress: () => {},
  isCancelled: () => ++checks > 2,
});

assert.equal(result.type, 'done');
assert.equal(result.placements, null);
assert.ok(checks > 2);
assert.ok(Number.isSafeInteger(result.nodes));
console.log('v2 product search cancellation test passed');
