import assert from 'node:assert/strict';
import { canonicalSignatureFromLabeledFrontierState, createLabeledFrontierStateCandidate, cpuTransitionLabeledFrontierStates, createWebGpuLabeledFrontierState, WEBGPU_LABELED_FRONTIER_STATE_SCHEMA } from '../src/webgpu-labeled-frontier-state.js';

const candidateInput = {
  pieceIds: [3, 49, 97],
  parentPlacements: [{ id: 3, cells: [{ x: 2, y: 0 }] }, { id: 49, cells: [{ x: 3, y: 0 }] }],
  candidate: { id: 97, cells: [{ x: 2, y: 1 }] },
  remainingIds: [97],
};
const candidate = createLabeledFrontierStateCandidate(candidateInput);
const cpu = cpuTransitionLabeledFrontierStates([candidate]);

const referencedCandidate = createLabeledFrontierStateCandidate({ ...candidateInput, parentStateIndex: 7 });
assert.equal(referencedCandidate.parentStateIndex, 7);
assert.deepEqual(cpuTransitionLabeledFrontierStates([referencedCandidate]), cpu);
assert.throws(
  () => createLabeledFrontierStateCandidate({ ...candidateInput, parentStateIndex: -1 }),
  /parentStateIndex must be a non-negative safe integer/,
);
assert.throws(
  () => cpuTransitionLabeledFrontierStates([{ ...candidate, parentStateIndex: 1.5 }]),
  /candidate 0\.parentStateIndex must be a non-negative safe integer/,
);
assert.throws(
  () => cpuTransitionLabeledFrontierStates([{ ...candidate, parentStateIndex: '7' }]),
  /candidate 0\.parentStateIndex must be a non-negative safe integer/,
);

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
assert.equal(unavailable.persistent, true);

const priorBufferUsage = globalThis.GPUBufferUsage, priorMapMode = globalThis.GPUMapMode;
globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, MAP_READ: 16 };
globalThis.GPUMapMode = { READ: 1 };
let createdBuffers = 0;
const expected = { next: cpu.nextLabels, canonical: cpu.canonicalLabels, absolute: cpu.absoluteHashes, canonicalHash: cpu.canonicalHashes };
const fakeAdapter = { limits: { maxStorageBufferBindingSize: 1024 * 1024 }, async requestDevice() { return {
  limits: { maxStorageBufferBindingSize: 1024 * 1024 },
  queue: { writeBuffer() {}, submit() {}, async onSubmittedWorkDone() {} },
  createBuffer() {
    createdBuffers += 1;
    const kind = ['next', 'canonical', 'absolute', 'canonicalHash'][createdBuffers - 10] || 'scratch';
    return { destroy() {}, async mapAsync() {}, getMappedRange() { return Uint32Array.from(expected[kind] || []).buffer; }, unmap() {} };
  },
  createShaderModule() { return {}; },
  createComputePipeline() { return { getBindGroupLayout() { return {}; } }; },
  createBindGroup() { return {}; },
  createCommandEncoder() { return { beginComputePass() { return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }; }, copyBufferToBuffer() {}, finish() { return {}; } }; },
}; } };
try {
  const persistent = createWebGpuLabeledFrontierState({ gpu: { async requestAdapter() { return fakeAdapter; } }, capacity: 2 });
  const first = await persistent.transition([candidate]), second = await persistent.transition([candidate]);
  assert.equal(first.status, 'completed');
  assert.equal(first.parity, 'verified');
  assert.equal(first.persistent, true);
  assert.deepEqual(second.canonicalLabels, cpu.canonicalLabels);
  assert.equal(createdBuffers, 13, 'persistent labeled state must reuse its device allocation');
  persistent.reset();
} finally {
  if (priorBufferUsage === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage = priorBufferUsage;
  if (priorMapMode === undefined) delete globalThis.GPUMapMode; else globalThis.GPUMapMode = priorMapMode;
}

console.log(JSON.stringify({ schema: cpu.schema, absoluteHash: cpu.absoluteHashes[0], canonicalHash: cpu.canonicalHashes[0], fallback: unavailable.reason }));
