import assert from 'node:assert/strict';
import { canonicalSignatureFromLabeledFrontierState, createLabeledFrontierStateCandidate, cpuTransitionLabeledFrontierStates, createWebGpuLabeledFrontierState, WEBGPU_LABELED_FRONTIER_STATE_SCHEMA } from '../src/webgpu-labeled-frontier-state.js';

const candidate = createLabeledFrontierStateCandidate({
  pieceIds: [3, 49, 97],
  parentPlacements: [{ id: 3, cells: [{ x: 2, y: 0 }] }, { id: 49, cells: [{ x: 3, y: 0 }] }],
  candidate: { id: 97, cells: [{ x: 2, y: 1 }] },
  remainingIds: [97],
});
const cpu = cpuTransitionLabeledFrontierStates([candidate]);

assert.equal(cpu.schema, WEBGPU_LABELED_FRONTIER_STATE_SCHEMA);
assert.deepEqual(cpu.pieceIds, [3, 49, 97]);
assert.equal(cpu.nextLabels.length, 3 * 128);
assert.equal(cpu.canonicalLabels.length, 3 * 128);
assert.equal(cpu.absoluteHashes.length, 1);
assert.notEqual(cpu.absoluteHashes[0], cpu.canonicalHashes[0]);
assert.equal(canonicalSignatureFromLabeledFrontierState({ pieceIds: cpu.pieceIds, canonicalLabels: cpu.canonicalLabels, wordCount: cpu.wordCount }), '3:0,0|49:1,0|97:0,1');

const unavailable = await createWebGpuLabeledFrontierState({ gpu: null }).transition([candidate]);
assert.equal(unavailable.status, 'unavailable');
assert.deepEqual(unavailable.nextLabels, cpu.nextLabels);
assert.deepEqual(unavailable.canonicalLabels, cpu.canonicalLabels);
assert.deepEqual(unavailable.absoluteHashes, cpu.absoluteHashes);
assert.deepEqual(unavailable.canonicalHashes, cpu.canonicalHashes);

console.log(JSON.stringify({ schema: cpu.schema, absoluteHash: cpu.absoluteHashes[0], canonicalHash: cpu.canonicalHashes[0], fallback: unavailable.reason }));
