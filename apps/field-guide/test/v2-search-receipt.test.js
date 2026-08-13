import assert from 'node:assert/strict';
import { neighborTargetAllowsProgress, neighborTargetMatches, search } from '../product/v2-legacy-search.js';
import { cpuGenerateFrontierCandidates } from '../../../packages/search-core/src/webgpu-frontier-generator.js';
import { cpuTransitionLabeledFrontierStates } from '../../../packages/search-core/src/webgpu-labeled-frontier-state.js';
import { cpuFrontierTopology } from '../../../packages/search-core/src/webgpu-frontier-topology.js';
import { cpuEvaluateFieldMetrics } from '../../../packages/search-core/src/webgpu-field-metrics.js';
import { cpuGenerateFrontierTargetBatch } from '../../../packages/search-core/src/webgpu-frontier-target-generator.js';
import { cpuGenerateFrontierTargetPoolBatch } from '../../../packages/search-core/src/webgpu-frontier-target-pool.js';
import { cpuDeduplicateFrontierStates } from '../../../packages/search-core/src/webgpu-frontier-deduplicator.js';
import { cpuCompactFrontierRows } from '../../../packages/search-core/src/webgpu-frontier-compactor.js';
import { cpuCompactFrontierCandidateRecords } from '../../../packages/search-core/src/webgpu-frontier-candidate-records.js';
import { createWebGpuFrontierNavigationPlanFromCandidateRecords } from '../../../packages/search-core/src/webgpu-frontier-navigation-plan.js';

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
let flatNavigationSelectCalls = 0;
const flatNavigationScheduler = {
  availability: async () => ({ status: 'available', backend: 'webgpu' }),
  select: async (rows, { planCount }) => {
    flatNavigationSelectCalls += 1;
    return { status: 'completed', backend: 'test-navigation-webgpu', parity: 'verified', rowCount: rows.length, selectedRows: rows.map((_, index) => index), selectedCount: rows.length, planCount, inputDigest: 'test-flat-navigation' };
  },
};
let fallbackFlatRecordCount = 0;
const fallbackTargetGenerator = {
  availability: async () => ({ status: 'available', backend: 'webgpu' }),
  generateBatch: async () => ({ status: 'unavailable', backend: 'webgpu', reason: 'test-target-generator-capacity' }),
};
const fallbackFlatNavigationScheduler = {
  availability: async () => ({ status: 'available', backend: 'webgpu' }),
  selectCandidateRecords: async (plans, { planCount }) => {
    const plan = createWebGpuFrontierNavigationPlanFromCandidateRecords(plans);
    const currentCount = plans.reduce((sum, plan) => sum + plan.records.length, 0);
    fallbackFlatRecordCount += currentCount;
    return { status: 'completed', backend: 'webgpu', parity: 'verified', plan, rowCount: currentCount, selectedRows: Array.from({ length: currentCount }, (_, index) => index), selectedCount: currentCount, planCount, inputDigest: 'test-fallback-flat-navigation' };
  },
};
let frontierCandidateRecordCalls = 0;
const frontierCandidateRecords = {
  compact: async records => { frontierCandidateRecordCalls += 1; return { ...cpuCompactFrontierCandidateRecords(records), status: 'completed', backend: 'test-frontier-candidate-records', parity: 'verified' }; },
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
assert.equal(neighborTargetAllowsProgress(4, 4), true);
assert.equal(neighborTargetAllowsProgress(5, 4), false, 'exact-neighbor search must prune partial states that already exceed the target');
assert.equal(neighborTargetMatches(4, 4), true);
assert.equal(neighborTargetMatches(5, 4), false, 'exact-neighbor search must reject completed states with the wrong count');
let residentExpansionCalls = 0, residentParentReferences = 0, residentLayerOpens = 0, residentLayerCommits = 0, residentEpoch = 0;
const residentNavigator = {
  beginLayer() { residentLayerOpens += 1; return { status: 'layer-open' }; },
  commitLayer() { residentLayerCommits += 1; return { status: 'layer-committed' }; },
  expand: async candidates => {
    residentExpansionCalls += 1;
    residentParentReferences += candidates.filter(candidate => candidate.parentStateIndex != null).length;
    const result = cpuTransitionLabeledFrontierStates(candidates);
    residentEpoch += 1;
    return { ...result, backend: 'resident-test-webgpu', parity: 'verified', persistent: true, resident: true, residentEpoch, residentStateIndices: candidates.map((_, index) => index), navigator: { status: 'resident', epoch: residentEpoch } };
  },
};
const singleResult = await search(pieces, [], { ...sharedOptions, frontierGenerator: singleFrontierGenerator });
const result = await search(pieces, [], { ...sharedOptions, frontierGenerator });
let residentScoreCalls = 0;
const residentScoreSelector = {
  selectScoreInputs: async (inputs, retain) => {
    residentScoreCalls += 1;
    return { status: 'completed', backend: 'webgpu', parity: 'verified', algorithm: 'resident-score-input-rank', readback: 'selected-indices', indices: inputs.map((_, index) => index).slice(0, retain), scores: inputs.map((input, index) => index) };
  },
};
const residentScoreResult = await search(pieces, [], { ...sharedOptions, frontierGenerator, residentBeamSelector: residentScoreSelector });
assert.ok(residentScoreCalls > 0);
assert.equal(residentScoreResult.frontierScore.status, 'used');
assert.equal(residentScoreResult.frontierScore.backend, 'webgpu');
assert.equal(residentScoreResult.frontierScore.resident, true);
assert.equal(residentScoreResult.frontierRanker.backend, 'webgpu');
const targetResult = await search(pieces, [], { ...sharedOptions, frontierTargetGenerator, frontierCandidateRecords });
const flatTargetResult = await search(pieces, [], { ...sharedOptions, frontierTargetGenerator, frontierCandidateRecords, navigationScheduler: flatNavigationScheduler });
let residentNavigationSelectCalls = 0;
let residentCompactionCalls = 0;
const residentTargetGenerator = {
  availability: async () => ({ status: 'available', backend: 'webgpu' }),
  generateBatch: async inputs => {
    const result = cpuGenerateFrontierTargetBatch(inputs);
    return { ...result, status: 'completed', backend: 'test-frontier-target-generator', parity: 'verified', residentHandle: { schema: 'tdotdh.webgpu-frontier-target-records.v0', recordsBuffer: {}, validityBuffer: {}, recordCount: result.candidateCount, itemCount: inputs.length } };
  },
};
const residentCandidateRecords = {
  compact: async records => ({ ...cpuCompactFrontierCandidateRecords(records), status: 'completed', backend: 'test-frontier-candidate-records', parity: 'verified' }),
  compactResident: async (_handle, { expectedRecords }) => { residentCompactionCalls += 1; return { status: 'completed', backend: 'test-frontier-candidate-records', parity: 'verified', persistent: true, residentHandle: { schema: 'tdotdh.webgpu-frontier-candidate-records-resident.v0', recordsBuffer: {}, recordCount: expectedRecords.length }, records: expectedRecords, inputCount: expectedRecords.length, outputCount: expectedRecords.length }; },
};
const residentNavigationScheduler = {
  ...flatNavigationScheduler,
  selectResidentCandidateRecords: async (entries, { expectedRows, planCount }) => { residentNavigationSelectCalls += 1; return { status: 'completed', backend: 'test-resident-navigation-webgpu', parity: 'verified', rowCount: expectedRows.length, selectedRows: expectedRows.map((_, index) => index), selectedCount: expectedRows.length, planCount, inputDigest: 'test-resident-navigation' }; },
};
const residentTargetResult = await search(pieces, [], { ...sharedOptions, frontierTargetGenerator: residentTargetGenerator, frontierCandidateRecords: residentCandidateRecords, navigationScheduler: residentNavigationScheduler });
assert.ok(residentNavigationSelectCalls > 0);
assert.equal(residentCompactionCalls, 1, 'parity-gated resident navigation compacts the GPU record handle at the result boundary');
assert.equal(residentTargetResult.navigationPlan.inputRepresentation, 'gpu-resident-compacted-records');
const fallbackTargetResult = await search(pieces, [], { ...sharedOptions, frontierTargetGenerator: fallbackTargetGenerator, navigationScheduler: fallbackFlatNavigationScheduler });
let targetFallbackGeneratorCalls = 0;
const targetFallbackGenerator = {
  ...frontierGenerator,
  generateBatch: async inputs => {
    targetFallbackGeneratorCalls += inputs.length;
    return frontierGenerator.generateBatch(inputs);
  },
};
const targetFallbackResult = await search(pieces, [], {
  ...sharedOptions,
  searchStrategy: 'depth',
  targetFamily: 'F-NONEXISTENT',
  targetSeed: '#99[0,0>0,0]',
  frontierGenerator: targetFallbackGenerator,
  frontierCompactor,
});
const targetPoolResult = await search(pieces, [], { ...sharedOptions, frontierTargetGenerator, frontierTargetPool });
const depthResult = await search(pieces, [], { ...sharedOptions, searchStrategy: 'depth', frontierCompactor });
const breadthResult = await search(pieces, [], { ...sharedOptions, searchStrategy: 'breadth', frontierCompactor });
let checkpointCursor = null;
const checkpointResult = await search(pieces, [], { ...sharedOptions, frontierGenerator, reportProgress: progress => { checkpointCursor = progress.cursor; } });
assert.ok(checkpointCursor?.checkpoint);
assert.ok(Number.isSafeInteger(checkpointCursor.checkpoint.randomState));
const resumedResult = await search(pieces, [], { ...sharedOptions, frontierGenerator, resumeCheckpoint: checkpointCursor.checkpoint });

const lockedPieces = [
  { id: 3, cells },
  { id: 1, cells },
  { id: 2, cells },
  { id: 4, cells },
];
let lockedTargetPoolCalls = 0;
let lockedNavigationBatchCalls = 0;
const lockedTargetPool = {
  availability: async () => ({ status: 'available', backend: 'webgpu' }),
  generateBatch: async inputs => {
    lockedTargetPoolCalls += inputs.length;
    return { ...cpuGenerateFrontierTargetPoolBatch(inputs), status: 'completed', backend: 'test-frontier-target-pool', parity: 'verified' };
  },
};
const lockedResult = await search(lockedPieces, [], {
  ...sharedOptions,
  forceCpuSeedSearch: true,
  searchStrategy: 'breadth',
  positionLocks: { 1: { dx: 3, dy: 0 } },
  frontierGenerator: singleFrontierGenerator,
  frontierTargetPool: lockedTargetPool,
  navigationBatch: () => { lockedNavigationBatchCalls += 1; },
});
const residentBaseline = await search(lockedPieces, [], { ...sharedOptions, searchStrategy: 'breadth', frontierGenerator });
const residentResult = await search(lockedPieces, [], { ...sharedOptions, searchStrategy: 'breadth', frontierGenerator, frontierNavigator: residentNavigator });
const gpuFirstBreadthResult = await search(lockedPieces, [], { ...sharedOptions, searchStrategy: 'breadth', frontierGenerator, gpuExecution: { deviceAvailable: true } });

assert.equal(result.type, 'done');
assert.deepEqual(singleResult.prefilter, { status: 'used', backend: 'test-compute-shader', candidateCount: 6 });
assert.deepEqual(result.prefilter, { status: 'used', backend: 'test-compute-shader', candidateCount: 3 });
assert.deepEqual(singleResult.frontier, { status: 'used', backend: 'test-frontier-evaluator', parity: 'verified', candidateCount: 6, validCount: 6, rejectedCount: 0, batch: 'beam', ticket: { presetFingerprint: 'test-preset', familyId: 'open', pass: 0, threadId: 0 }, cursor: { depth: 0, nodeOffset: 0, rootChoice: 0 } });
assert.deepEqual(result.frontier, { status: 'used', backend: 'test-frontier-evaluator', parity: 'verified', candidateCount: 3, validCount: 3, rejectedCount: 0, batch: 'beam', ticket: { presetFingerprint: 'test-preset', familyId: 'open', pass: 0, threadId: 0 }, cursor: { depth: 0, nodeOffset: 0, rootChoice: 0 } });
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
assert.ok(frontierCandidateRecordCalls > 0);
assert.equal(targetResult.frontierTargetGeneration.candidateRecords.backend, 'test-frontier-candidate-records');
assert.deepEqual(targetResult.placements, result.placements);
assert.deepEqual(targetResult.metrics, result.metrics);
assert.ok(flatNavigationSelectCalls > 0);
assert.deepEqual(flatTargetResult.placements, result.placements);
assert.deepEqual(flatTargetResult.metrics, result.metrics);
assert.ok(fallbackFlatRecordCount > 0, 'target-generator fallback must preserve flat records for GPU navigation');
assert.equal(fallbackTargetResult.frontierTargetGeneration.status, 'fallback');
assert.equal(fallbackTargetResult.navigationPlan.status, 'used');
assert.ok(targetFallbackGeneratorCalls > 0, 'failed family target must resume open GPU frontier generation');
assert.equal(targetFallbackResult.frontierGeneration.status, 'used');
assert.equal(targetFallbackResult.frontierGeneration.backend, 'test-frontier-generator');
assert.equal(targetPoolResult.frontierTargetPool.status, 'used');
assert.equal(targetPoolResult.frontierTargetPool.backend, 'test-frontier-target-pool');
assert.equal(targetPoolResult.frontierTargetPool.batch, 'beam');
assert.equal(depthResult.frontierCompactor.status, 'used');
assert.equal(depthResult.frontierCompactor.backend, 'test-frontier-compactor');
assert.equal(depthResult.frontierCompactor.parity, 'verified');
assert.equal(breadthResult.frontierCompactor.status, 'used');
assert.equal(breadthResult.frontierCompactor.batch, 'breadth-quota');
assert.equal(breadthResult.frontierCompactor.backend, 'test-frontier-compactor');
assert.ok(residentExpansionCalls > 0);
assert.ok(residentParentReferences > 0, 'later beam layers must submit resident parent references');
assert.ok(residentLayerOpens > 0, 'resident navigator must own locked-branch layer boundaries');
assert.equal(residentLayerCommits, residentLayerOpens, 'resident locked-branch layers must commit exactly once');
assert.equal(residentResult.frontierState.resident, true);
assert.equal(residentResult.frontierState.backend, 'resident-test-webgpu');
assert.deepEqual(residentResult.placements, residentBaseline.placements);
assert.deepEqual(residentResult.metrics, residentBaseline.metrics);
assert.equal(gpuFirstBreadthResult.frontierGeneration.status, 'used', 'GPU-capable breadth search must reach frontier generation instead of returning from the CPU locked-branch shortcut');
assert.equal(gpuFirstBreadthResult.frontierGeneration.backend, 'test-frontier-generator');
assert.ok(frontierDeduplicatorCalls > 0);
assert.equal(targetPoolResult.frontierDedup.status, 'used');
assert.equal(targetPoolResult.frontierDedup.backend, 'test-frontier-deduplicator');
assert.deepEqual(targetPoolResult.placements, result.placements);
assert.deepEqual(targetPoolResult.metrics, result.metrics);
assert.deepEqual(resumedResult.placements, checkpointResult.placements);
assert.deepEqual(resumedResult.metrics, checkpointResult.metrics);
assert.ok(lockedTargetPoolCalls > 0);
assert.ok(lockedNavigationBatchCalls > 0, 'locked family branches must report navigation batches to the coordinator');
assert.equal(lockedResult.frontierTargetPool.status, 'used');
assert.equal(lockedResult.frontierTargetPool.backend, 'test-frontier-target-pool');
assert.equal(lockedResult.frontierTargetPool.batch, 'locked-branch');
console.log('v2 product search receipt test passed');
