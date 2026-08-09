import assert from 'node:assert/strict';
import { createCpuWorkerHandler } from '../src/cpu-worker-entry.js';

const events = [];
const handleMessage = createCpuWorkerHandler({ postMessage: event => events.push(event) });
await handleMessage({
  type: 'start',
  protocolVersion: 1,
  requestId: 'worker-entry-1',
  presetFingerprint: 'preset-v0',
  catalogRevision: 'catalog-v0',
  seed: 'seed-v0',
  ticket: { presetFingerprint: 'preset-v0', familyId: 'F-0RHDG0U', pass: 0, threadId: 0 },
  cursor: { depth: 0, nodeOffset: 0, rootChoice: 0 },
  budget: { maxNodes: 1, maxMilliseconds: 1000 },
  pieces: [{ id: 1, cells: [{ x: 0, y: 0 }] }],
  constraints: { candidateArrangements: [[{ pieceId: 1, cells: [{ x: 0, y: 0 }] }]] },
  knownSignatureHints: [],
});

assert.deepEqual(events.map(event => event.type), ['started', 'progress', 'result', 'completed']);
assert.equal(events[2].canonicalSignatures.length, 1);
assert.equal(events[2].cursor.nodeOffset, 1);
assert.equal(events[3].ticket.familyId, 'F-0RHDG0U');
assert.equal(events.every(event => event.requestId === 'worker-entry-1'), true);

console.log('CPU worker entry tests passed');
