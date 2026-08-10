import assert from 'node:assert/strict';
import { search } from '../product/v2-legacy-search.js';
import { cpuGenerateFrontierCandidates } from '../../../packages/search-core/src/webgpu-frontier-generator.js';
import { cpuTransitionLabeledFrontierStates } from '../../../packages/search-core/src/webgpu-labeled-frontier-state.js';
import { cpuFrontierTopology } from '../../../packages/search-core/src/webgpu-frontier-topology.js';
import { cpuEvaluateFieldMetrics } from '../../../packages/search-core/src/webgpu-field-metrics.js';
import { cpuGenerateFrontierTargetBatch } from '../../../packages/search-core/src/webgpu-frontier-target-generator.js';
import { cpuGenerateFrontierTargetPoolBatch } from '../../../packages/search-core/src/webgpu-frontier-target-pool.js';
import { cpuDeduplicateFrontierStates } from '../../../packages/search-core/src/webgpu-frontier-deduplicator.js';
import { cpuCompactFrontierRows } from '../../../packages/search-core/src/webgpu-frontier-compactor.js';

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
const singleFrontierGenerator = {
  availability: async () => ({ status: 'available', backend: 'webgpu' }),
  generate: async input => {
    const result = cpuGenerateFrontierCandidates(input);
    return { ...result, status: 'completed', backend: 'test-frontier-generator', parity: 'verified' };
  },
};
const frontierGenerator = {
  ...singleFrontierGenerator,
  generateBatch: async inputs => {
    const items = inputs.map(input => {
      const result = cpuGenerateFrontierCandidates(input);
      return { pieceId: input.pieceId, ...result };
    });
    return { status: 'completed', backend: 'test-frontier-generator', parity: 'verified', items, candidateCount: items.reduce((sum, item) => sum + item.candidateCount, 0) };
  },
};
const frontierState = {
  transition: async candidates => ({ ...cpuTransitionLabeledFrontierStates(candidates), backend: 'test-frontier-state', parity: 'verified' }),
};
const fieldMetrics = {
  evaluate: async candidates => ({ ...cpuEvaluateFieldMetrics(candidates), backend: 'test-field-metrics', parity: 'verified' }),
};
const frontierTargetGenerator = {
  availability: async () => ({ status: 'available', backend: 'webgpu' }),
  generateBatch: async inputs => ({ ...cpuGenerateFrontierTargetBatch(inputs), status: 'completed', backend: 'test-frontier-target-generator', parity: 'verified' }),
};
const frontierTargetPool = {
  availability: async () => ({ status: 'available', backend: 'webgpu' }),
  generateBatch: async inputs => ({ ...cpuGenerateFrontierTargetPoolBatch(inputs), status: 'completed', backend: 'test-frontier-target-pool', parity: 'verified' }),
};
const frontierTopology = {
  evaluate: async input => ({ ...cpuFrontierTopology(input), backend: 'test-frontier-topology', parity: 'verified' }),
};
const frontierCompactor = {
  compact: async (rows, retain) => ({ ...cpuCompactFrontierRows(rows, retain), backend: 'test-frontier-compactor', parity: 'verified', algorithm: 'test-top-k' }),
};
let frontierDeduplicatorCalls = 0;
const frontierDeduplicator = {
  availability: async () => ({ status: 'available', backend: 'webgpu' }),
  deduplicate: async rows => {
    frontierDeduplicatorCalls += 1;
    return { ...cpuDeduplicateFrontierStates(rows), status: 'completed', backend: 'test-frontier-deduplicator', parity: 'verified' };
  },
};
const sharedOptions = {
  searchStrategy: 'balanced',
  candidatePrefilter,
  frontierValidator,
  frontierEvaluator,
  frontierState,
  frontierTopology,
  fieldMetrics,
  frontierDeduplicator,
  navigationTicket: { presetFingerprint: 'test-preset', familyId: 'open', pass: 0, threadId: 0 },
  navigationCursor: { depth: 0, nodeOffset: 0, rootChoice: 0 },
};
const singleResult = await search(pieces, [], { ...sharedOptions, frontierGenerator: singleFrontierGenerator });
const result = await search(pieces, [], { ...sharedOptions, frontierGenerator });
const targetResult = await search(pieces, [], { ...sharedOptions, frontierTargetGenerator });
const targetPoolResult = await search(pieces, [], { ...sharedOptions, frontierTargetGenerator, frontierTargetPool });
const depthResult = await search(pieces, [], { ...sharedOptions, searchStrategy: 'depth', frontierCompactor });
let checkpointCursor = null;
const checkpointResult = await search(pieces, [], { ...sharedOptions, frontierGenerator, reportProgress: progress => { checkpointCursor = progress.cursor; } });
assert.ok(checkpointCursor?.checkpoint);
const resumedResult = await search(pieces, [], { ...sharedOptions, frontierGenerator, resumeCheckpoint: checkpointCursor.checkpoint });

const lockedPieces = [
  { id: 3, cells },
  { id: 1, cells },
  { id: 2, cells },
  { id: 4, cells },
];
let lockedTargetPoolCalls = 0;
const lockedTargetPool = {
  availability: async () => ({ status: 'available', backend: 'webgpu' }),
  generateBatch: async inputs => {
    lockedTargetPoolCalls += inputs.length;
    return { ...cpuGenerateFrontierTargetPoolBatch(inputs), status: 'completed', backend: 'test-frontier-target-pool', parity: 'verified' };
  },
};
const lockedResult = await search(lockedPieces, [], {
  ...sharedOptions,
  searchStrategy: 'breadth',
  positionLocks: { 1: { dx: 3, dy: 0 } },
  frontierGenerator: singleFrontierGenerator,
  frontierTargetPool: lockedTargetPool,
});

assert.equal(result.type, 'done');
assert.deepEqual(singleResult.prefilter, { status: 'used', backend: 'test-compute-shader', candidateCount: 6 });
assert.deepEqual(result.prefilter, { status: 'used', backend: 'test-compute-shader', candidateCount: 3 });
assert.deepEqual(singleResult.frontier, { status: 'used', backend: 'test-frontier-evaluator', parity: 'verified', candidateCount: 6, batch: 'beam', ticket: { presetFingerprint: 'test-preset', familyId: 'open', pass: 0, threadId: 0 }, cursor: { depth: 0, nodeOffset: 0, rootChoice: 0 } });
assert.deepEqual(result.frontier, { status: 'used', backend: 'test-frontier-evaluator', parity: 'verified', candidateCount: 3, batch: 'beam', ticket: { presetFingerprint: 'test-preset', familyId: 'open', pass: 0, threadId: 0 }, cursor: { depth: 0, nodeOffset: 0, rootChoice: 0 } });
assert.equal(result.frontierGeneration.status, 'used');
assert.equal(result.frontierGeneration.backend, 'test-frontier-generator');
assert.equal(result.frontierGeneration.parity, 'verified');
assert.equal(result.frontierGeneration.batch, 'beam');
assert.equal(result.frontierGeneration.batches, 1);
assert.equal(result.frontierState.status, 'used');
assert.equal(result.frontierState.backend, 'test-frontier-state');
assert.equal(result.frontierState.finalCanonicalParity, 'verified');
assert.equal(result.frontierTopology.status, 'used');
assert.equal(result.frontierTopology.backend, 'test-frontier-topology');
assert.equal(result.fieldMetrics.status, 'used');
assert.equal(result.fieldMetrics.backend, 'test-field-metrics');
assert.deepEqual(result.placements, singleResult.placements);
assert.deepEqual(result.metrics, singleResult.metrics);
assert.equal(targetResult.frontierTargetGeneration.status, 'used');
assert.equal(targetResult.frontierTargetGeneration.backend, 'test-frontier-target-generator');
assert.deepEqual(targetResult.placements, result.placements);
assert.deepEqual(targetResult.metrics, result.metrics);
assert.equal(targetPoolResult.frontierTargetPool.status, 'used');
assert.equal(targetPoolResult.frontierTargetPool.backend, 'test-frontier-target-pool');
assert.equal(targetPoolResult.frontierTargetPool.batch, 'beam');
assert.equal(depthResult.frontierCompactor.status, 'used');
assert.equal(depthResult.frontierCompactor.backend, 'test-frontier-compactor');
assert.equal(depthResult.frontierCompactor.parity, 'verified');
assert.ok(frontierDeduplicatorCalls > 0);
assert.equal(targetPoolResult.frontierDedup.status, 'used');
assert.equal(targetPoolResult.frontierDedup.backend, 'test-frontier-deduplicator');
assert.deepEqual(targetPoolResult.placements, result.placements);
assert.deepEqual(targetPoolResult.metrics, result.metrics);
assert.deepEqual(resumedResult.placements, checkpointResult.placements);
assert.deepEqual(resumedResult.metrics, checkpointResult.metrics);
assert.ok(lockedTargetPoolCalls > 0);
assert.equal(lockedResult.frontierTargetPool.status, 'used');
assert.equal(lockedResult.frontierTargetPool.backend, 'test-frontier-target-pool');
assert.equal(lockedResult.frontierTargetPool.batch, 'locked-branch');
console.log('v2 product search receipt test passed');
