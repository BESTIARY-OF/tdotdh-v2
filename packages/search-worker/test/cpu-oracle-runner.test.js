import assert from 'node:assert/strict';
import { createSearchRequest } from '../src/protocol.js';
import { canonicalPlacementSignature, runCpuOracleBatch } from '../src/cpu-oracle-runner.js';

const first = [{ pieceId: 2, cells: [{ x: 1, y: 0 }, { x: 0, y: 0 }] }, { pieceId: 1, cells: [{ x: 0, y: 1 }] }];
const equivalent = [{ pieceId: 1, cells: [{ x: 0, y: 1 }] }, { pieceId: 2, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }];
assert.equal(canonicalPlacementSignature(first), canonicalPlacementSignature(equivalent));
const translated = first.map(placement => ({ ...placement, cells: placement.cells.map(cell => ({ x: cell.x + 17, y: cell.y - 9 })) }));
assert.equal(canonicalPlacementSignature(first), canonicalPlacementSignature(translated));

const request = createSearchRequest({
  type: 'start',
  protocolVersion: 1,
  requestId: 'runner-1',
  presetFingerprint: 'preset-v0',
  catalogRevision: 'catalog-v0',
  seed: 'seed-v0',
  ticket: { presetFingerprint: 'preset-v0', familyId: 'F-0RHDG0U', pass: 3, threadId: 1 },
  cursor: { depth: 7, nodeOffset: 0, rootChoice: 0 },
  budget: { maxNodes: 2, maxMilliseconds: 1000 },
  pieces: [{ id: 1, cells: [{ x: 0, y: 0 }] }],
  constraints: { candidateArrangements: [first, equivalent, [{ pieceId: 3, cells: [{ x: 2, y: 2 }] }]] },
  knownSignatureHints: [],
});
const progress = [];
const result = await runCpuOracleBatch(request, { reportProgress: value => progress.push(value) });
assert.deepEqual(result.ticket, request.ticket);
assert.deepEqual(result.cursor, { ...request.cursor, nodeOffset: 2 });
assert.equal(result.nodes, 2);
assert.equal(result.canonicalSignatures.length, 1);
assert.equal(progress.at(-1).cursor.nodeOffset, 2);

const resumed = await runCpuOracleBatch({ ...request, cursor: { ...request.cursor, nodeOffset: 2 }, budget: { ...request.budget, maxNodes: 1 } });
assert.equal(resumed.canonicalSignatures.length, 1);
assert.equal(resumed.cursor.nodeOffset, 3);

const prefiltered = await runCpuOracleBatch(request, {
  candidatePrefilter: { prefilter: async () => ({ status: 'completed', backend: 'webgpu', validity: [0, 1, 0] }) },
});
assert.equal(prefiltered.canonicalSignatures.length, 1);
assert.equal(prefiltered.canonicalSignatures[0], canonicalPlacementSignature(equivalent));
assert.equal(prefiltered.prefilter.status, 'used');
assert.equal(prefiltered.nodes, 2);

console.log('CPU oracle runner tests passed');
