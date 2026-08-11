import { installCpuWorker } from '../../../packages/search-worker/src/cpu-worker-entry.js';
import { createWebGpuCandidatePrefilter } from '../../../packages/search-core/src/webgpu-candidate-prefilter.js';
import { createWebGpuFrontierValidator } from '../../../packages/search-core/src/webgpu-frontier-validator.js';
import { createWebGpuFrontierEvaluator } from '../../../packages/search-core/src/webgpu-frontier-evaluator.js';
import { createWebGpuFrontierGenerator } from '../../../packages/search-core/src/webgpu-frontier-generator.js?v=20260810-gpu26';
import { createWebGpuFrontierTargetGenerator } from '../../../packages/search-core/src/webgpu-frontier-target-generator.js?v=20260811-resident4';
import { createWebGpuFrontierTargetPool } from '../../../packages/search-core/src/webgpu-frontier-target-pool.js';
import { createWebGpuFrontierMetrics } from '../../../packages/search-core/src/webgpu-frontier-metrics.js?v=20260810-gpu26';
import { createWebGpuFieldMetrics } from '../../../packages/search-core/src/webgpu-field-metrics.js';
import { createWebGpuLabeledFrontierState } from '../../../packages/search-core/src/webgpu-labeled-frontier-state.js?v=20260810-state3';
import { createWebGpuFrontierTopology } from '../../../packages/search-core/src/webgpu-frontier-topology.js?v=20260810-topology2';
import { createWebGpuFrontierRanker } from '../../../packages/search-core/src/webgpu-frontier-ranker.js?v=20260810-gpu4';
import { createWebGpuPersistentFrontierCompactor } from '../../../packages/search-core/src/webgpu-frontier-compactor.js?v=20260810-gpu4';
import { createWebGpuResidentBeamSelector } from '../../../packages/search-core/src/webgpu-resident-beam-selector.js?v=20260811-beam2';
import { createWebGpuFrontierDeduplicator } from '../../../packages/search-core/src/webgpu-frontier-deduplicator.js?v=20260810-gpu3';
import { createWebGpuFrontierNavigator } from '../../../packages/search-core/src/webgpu-frontier-navigator.js';
import { createWebGpuResidentFrontierState } from '../../../packages/search-core/src/webgpu-resident-frontier-state.js?v=20260810-gpu38';
import { createWebGpuFrontierCandidateRecords } from '../../../packages/search-core/src/webgpu-frontier-candidate-records.js?v=20260811-resident2';
import { createWebGpuFrontierScorer } from '../../../packages/search-core/src/webgpu-frontier-scorer.js';
import { createWebGpuFrontierNavigationScheduler } from '../../../packages/search-core/src/webgpu-frontier-navigation-plan.js?v=20260811-resident2';
import { createWebGpuDeviceCache } from '../../../packages/search-core/src/webgpu-device-cache.js?v=20260811-lifecycle1';
import { probeWebGpuExecutionCapabilities } from '../../../packages/search-core/src/webgpu-execution-probe.js?v=20260810-gpu35';
import { createNavigationCoordinator } from '../../../packages/search-worker/src/navigation-coordinator.js?v=20260811-gpu-expansion2';
import { search } from './v2-legacy-search.js?v=20260811-gpufirst7';

const deviceCache = createWebGpuDeviceCache({ gpu: globalThis.navigator?.gpu });
const candidatePrefilter = createWebGpuCandidatePrefilter({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierValidator = createWebGpuFrontierValidator({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierEvaluator = createWebGpuFrontierEvaluator({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierGenerator = createWebGpuFrontierGenerator({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierTargetGenerator = createWebGpuFrontierTargetGenerator({ gpu: globalThis.navigator?.gpu, deviceCache });
  const frontierTargetPool = createWebGpuFrontierTargetPool({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierMetrics = createWebGpuFrontierMetrics({ gpu: globalThis.navigator?.gpu, deviceCache });
const fieldMetrics = createWebGpuFieldMetrics({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierState = createWebGpuLabeledFrontierState({ gpu: globalThis.navigator?.gpu, deviceCache });
const residentFrontierState = createWebGpuResidentFrontierState({ gpu: globalThis.navigator?.gpu });
const frontierCandidateRecords = createWebGpuFrontierCandidateRecords({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierScorer = createWebGpuFrontierScorer({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierTopology = createWebGpuFrontierTopology({ gpu: globalThis.navigator?.gpu });
const frontierRanker = createWebGpuFrontierRanker({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierCompactor = createWebGpuPersistentFrontierCompactor({ gpu: globalThis.navigator?.gpu, deviceCache });
const residentBeamSelector = createWebGpuResidentBeamSelector({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierDeduplicator = createWebGpuFrontierDeduplicator({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierNavigationScheduler = createWebGpuFrontierNavigationScheduler({ gpu: globalThis.navigator?.gpu, deviceCache });
const gpuStageAdapters = Object.freeze({ prefilter: candidatePrefilter, frontier: frontierEvaluator, frontierGeneration: frontierGenerator, frontierTargetGeneration: frontierTargetGenerator, frontierTargetPool, frontierMetrics, fieldMetrics, frontierState, frontierTopology, frontierRanker, frontierCompactor, frontierDedup: frontierDeduplicator, frontierScore: frontierScorer, navigationPlan: frontierNavigationScheduler });
let gpuStageAvailabilityPromise = null;
async function getGpuStageAvailability() {
  if (!gpuStageAvailabilityPromise) gpuStageAvailabilityPromise = Promise.all(Object.entries(gpuStageAdapters).map(async ([name, adapter]) => [name, adapter?.availability ? await adapter.availability() : { status: 'unavailable', reason: 'stage-does-not-expose-availability' }])).then(entries => Object.freeze(Object.fromEntries(entries)));
  return gpuStageAvailabilityPromise;
}
async function runGpuProbe() {
  const gpuExecution = await probeWebGpuExecutionCapabilities({ gpu: globalThis.navigator?.gpu, requiredLimits: { maxStorageBufferBindingSize: 33554432 }, deviceCache });
  return { type: 'gpu-probe', gpuExecution, stageAvailability: await getGpuStageAvailability(), workerNavigatorGpu: typeof globalThis.navigator?.gpu !== 'undefined' };
}
async function runProductSearch(request, context) {
  const steering = request.steering || {};
  const benchmarkBackend = steering.benchmarkBackend === 'cpu' || steering.benchmarkBackend === 'gpu'
    ? steering.benchmarkBackend
    : null;
  const forceCpuBenchmark = benchmarkBackend === 'cpu';
  residentFrontierState.reset();
  const gpuExecution = forceCpuBenchmark
    ? { deviceAvailable: false, reason: 'benchmark-forced-cpu', stageAvailability: {} }
    : await probeWebGpuExecutionCapabilities({ gpu: globalThis.navigator?.gpu, requiredLimits: { maxStorageBufferBindingSize: 33554432 }, deviceCache });
  const navigation = createNavigationCoordinator({ ticket: request.ticket, cursor: request.cursor });
  const frontierNavigator = createWebGpuFrontierNavigator({ stateAdapter: residentFrontierState, ticket: request.ticket, cursor: request.cursor, isCancelled: context.isCancelled });
  let executionDecision = null;
  const stageAvailability = forceCpuBenchmark ? {} : await getGpuStageAvailability();
  const stage = (name, adapter = gpuStageAdapters[name]) => forceCpuBenchmark ? null : adapter;
  const result = await search(request.pieces, steering.knownCentroidFamilies || [], {
    ...steering,
    gpuExecution: { ...gpuExecution, stageAvailability },
    knownSignatures: request.knownSignatureHints,
    searchSalt: request.seed,
    rootChoice: request.ticket.rootChoice ?? request.cursor.rootChoice,
    threadId: request.ticket.threadId,
    navigationTicket: request.ticket,
    navigationCursor: request.cursor,
    resumeCheckpoint: request.cursor.checkpoint,
    candidatePrefilter: stage('prefilter'),
    frontierValidator: stage('frontierValidator', frontierValidator),
    frontierEvaluator: stage('frontier'),
    frontierGenerator: stage('frontierGeneration'),
    frontierTargetGenerator: stage('frontierTargetGeneration'),
    frontierTargetPool: stage('frontierTargetPool'),
    frontierCandidateRecords: stage('frontierTargetGeneration'),
    frontierScorer: stage('frontierScore'),
    frontierMetrics: stage('frontierMetrics'),
    fieldMetrics: stage('fieldMetrics'),
    frontierState: stage('frontierState'),
    frontierNavigator,
    frontierTopology: stage('frontierTopology'),
    frontierRanker: stage('frontierRanker'),
    frontierCompactor: stage('frontierCompactor'),
    residentBeamSelector: stage('frontierScore'),
    frontierDeduplicator: stage('frontierDedup'),
    navigationScheduler: gpuExecution.deviceAvailable ? frontierNavigationScheduler : createWebGpuFrontierNavigationScheduler({ gpu: null }),
    isCancelled: context.isCancelled,
    navigationBatch: details => navigation.beginBatch(details),
    navigationCancellation: cancelled => navigation.observeCancellation(cancelled),
    reportProgress: progress => context.reportProgress({ ...progress, cursor: navigation.observeProgress(progress.cursor) }),
    reportExecutionDecision: decision => { executionDecision = decision; },
  });
  return {
    ...result,
    gpuExecution: { ...gpuExecution, stageAvailability },
    navigation: navigation.complete({ ...result, gpuExecution }),
    placements: Array.isArray(result?.placements) ? result.placements : [],
    hasPlacement: Array.isArray(result?.placements) && result.placements.length > 0,
    benchmarkBackend,
    executionDecision,
    protocolOperation: 'product-search',
  };
}

const protocolHandle = installCpuWorker(self, {
  candidatePrefilter,
  frontierValidator,
  operations: { 'product-search': runProductSearch },
});

self.onmessage = event => {
  const message = event?.data;
  if (message?.type === 'probe') {
    void runGpuProbe().then(result => self.postMessage(result)).catch(error => self.postMessage({ type: 'gpu-probe-failed', error: { message: error?.message || String(error) } }));
    return;
  }
  if (message?.type === 'start' || message?.type === 'cancel') {
    void protocolHandle(message);
    return;
  }
  try {
    void search(message?.pieces, message?.knownCentroidFamilies || [], { ...message, candidatePrefilter, frontierValidator, frontierEvaluator, frontierGenerator, frontierTargetGenerator, frontierTargetPool, frontierCandidateRecords, frontierScorer, frontierMetrics, fieldMetrics, frontierState, frontierTopology, frontierRanker, frontierDeduplicator, residentBeamSelector, navigationScheduler: frontierNavigationScheduler })
      .then(result => self.postMessage(result))
      .catch(error => self.postMessage({ type: 'done', placements: null, metrics: null, nodes: 0, error: error.message }));
  } catch (error) {
    self.postMessage({ type: 'done', placements: null, metrics: null, nodes: 0, error: error.message });
  }
};
