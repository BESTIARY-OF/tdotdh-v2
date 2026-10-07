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

let residentCancelled = false;
const residentResult = await search(pieces, [], {
  searchStrategy: 'depth',
  reportProgress: () => {},
  isCancelled: () => residentCancelled,
  residentBeamSelector: {
    select: async () => {
      residentCancelled = true;
      return { status: 'cancelled', backend: 'webgpu', parity: 'deferred', reason: 'test-resident-cancellation' };
    },
  },
  frontierCompactor: null,
});
assert.equal(residentResult.placements, null);
assert.equal(residentResult.frontierCompactor.status, 'cancelled');
assert.ok(residentResult.cursor?.checkpoint?.beam?.length > 0);

const resumedResult = await search(pieces, [], {
  searchStrategy: 'depth',
  reportProgress: () => {},
  resumeCheckpoint: residentResult.cursor.checkpoint,
});
assert.equal(resumedResult.type, 'done');
assert.ok(resumedResult.cursor.depth >= residentResult.cursor.depth);
assert.ok(resumedResult.cursor.nodeOffset >= residentResult.cursor.nodeOffset);
assert.ok(resumedResult.cursor.checkpoint?.beam?.length > 0);
console.log('v2 product search cancellation test passed');
