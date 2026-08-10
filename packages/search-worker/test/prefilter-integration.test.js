import assert from 'node:assert/strict';
import { createCpuWorkerHandler } from '../src/cpu-worker-entry.js';

const messages = [];
const handleMessage = createCpuWorkerHandler({
  postMessage: message => messages.push(message),
  candidatePrefilter: {
    prefilter: async candidates => ({
      status: 'completed',
      backend: 'webgpu',
      validity: candidates.map((_, index) => index === 0 ? 1 : 0),
    }),
  },
});

await handleMessage({
  type: 'start',
  protocolVersion: 1,
  requestId: 'prefilter-integration',
  presetFingerprint: 'preset-v0',
  catalogRevision: 'catalog-v0',
  seed: 'seed-v0',
  ticket: { presetFingerprint: 'preset-v0', familyId: 'F-0RHDG0U', pass: 4, threadId: 0 },
  cursor: { depth: 3, nodeOffset: 0, rootChoice: 0 },
  budget: { maxNodes: 2, maxMilliseconds: 1000 },
  pieces: [{ id: 1, cells: [{ x: 0, y: 0 }] }],
  constraints: {
    candidateArrangements: [
      [{ pieceId: 1, cells: [{ x: 0, y: 0 }] }],
      [{ pieceId: 1, cells: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }],
    ],
  },
  knownSignatureHints: [],
});

const result = messages.find(message => message.type === 'result');
const completed = messages.find(message => message.type === 'completed');
assert.ok(result);
assert.deepEqual(result.placements, [{ pieceId: 1, cells: [{ x: 0, y: 0 }] }]);
assert.deepEqual(result.prefilter, { status: 'used', backend: 'webgpu', candidateCount: 2 });
assert.equal(result.cursor.nodeOffset, 2);
assert.equal(completed.nodes, 2);
assert.equal(messages.at(-1).type, 'completed');

console.log('CPU worker prefilter integration test passed');
