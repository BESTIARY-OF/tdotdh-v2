import { installCpuWorker } from '../../../packages/search-worker/src/cpu-worker-entry.js';
import { createWebGpuCandidatePrefilter } from '../../../packages/search-core/src/webgpu-candidate-prefilter.js';
import { createWebGpuFrontierValidator } from '../../../packages/search-core/src/webgpu-frontier-validator.js';
import { createWebGpuFrontierEvaluator } from '../../../packages/search-core/src/webgpu-frontier-evaluator.js';
import { createWebGpuFrontierGenerator } from '../../../packages/search-core/src/webgpu-frontier-generator.js?v=20260810-gpu25';
import { createWebGpuFrontierTargetGenerator } from '../../../packages/search-core/src/webgpu-frontier-target-generator.js';
import { createWebGpuFrontierTargetPool } from '../../../packages/search-core/src/webgpu-frontier-target-pool.js';
import { createWebGpuFrontierMetrics } from '../../../packages/search-core/src/webgpu-frontier-metrics.js?v=20260810-gpu25';
import { createWebGpuFieldMetrics } from '../../../packages/search-core/src/webgpu-field-metrics.js';
import { createWebGpuLabeledFrontierState } from '../../../packages/search-core/src/webgpu-labeled-frontier-state.js';
import { createWebGpuFrontierTopology } from '../../../packages/search-core/src/webgpu-frontier-topology.js';
import { createWebGpuFrontierRanker } from '../../../packages/search-core/src/webgpu-frontier-ranker.js';
import { createWebGpuPersistentFrontierCompactor } from '../../../packages/search-core/src/webgpu-frontier-compactor.js';
import { createWebGpuFrontierDeduplicator } from '../../../packages/search-core/src/webgpu-frontier-deduplicator.js';
import { createWebGpuFrontierNavigator } from '../../../packages/search-core/src/webgpu-frontier-navigator.js';
import { createWebGpuResidentFrontierState } from '../../../packages/search-core/src/webgpu-resident-frontier-state.js?v=20260810-gpu26';
import { createWebGpuFrontierCandidateRecords } from '../../../packages/search-core/src/webgpu-frontier-candidate-records.js';
import { createWebGpuFrontierScorer } from '../../../packages/search-core/src/webgpu-frontier-scorer.js';
import { createWebGpuDeviceCache } from '../../../packages/search-core/src/webgpu-device-cache.js';
import { createNavigationCoordinator } from '../../../packages/search-worker/src/navigation-coordinator.js';
import { search } from './v2-legacy-search.js?v=20260810-gpu25';

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
const residentFrontierState = createWebGpuResidentFrontierState({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierCandidateRecords = createWebGpuFrontierCandidateRecords({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierScorer = createWebGpuFrontierScorer({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierTopology = createWebGpuFrontierTopology({ gpu: globalThis.navigator?.gpu });
const frontierRanker = createWebGpuFrontierRanker({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierCompactor = createWebGpuPersistentFrontierCompactor({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierDeduplicator = createWebGpuFrontierDeduplicator({ gpu: globalThis.navigator?.gpu, deviceCache });
async function runProductSearch(request, context) {
  const steering = request.steering || {};
  residentFrontierState.reset();
  const navigation = createNavigationCoordinator({ ticket: request.ticket, cursor: request.cursor });
  const frontierNavigator = createWebGpuFrontierNavigator({ stateAdapter: residentFrontierState, ticket: request.ticket, cursor: request.cursor, isCancelled: context.isCancelled });
  const result = await search(request.pieces, steering.knownCentroidFamilies || [], {
    ...steering,
    knownSignatures: request.knownSignatureHints,
    searchSalt: request.seed,
    rootChoice: request.ticket.rootChoice ?? request.cursor.rootChoice,
    threadId: request.ticket.threadId,
    navigationTicket: request.ticket,
    navigationCursor: request.cursor,
    resumeCheckpoint: request.cursor.checkpoint,
    candidatePrefilter,
    frontierValidator,
    frontierEvaluator,
    frontierGenerator,
    frontierTargetGenerator,
    frontierTargetPool,
    frontierCandidateRecords,
    frontierScorer,
    frontierMetrics,
    fieldMetrics,
    frontierState,
    frontierNavigator,
    frontierTopology,
    frontierRanker,
    frontierCompactor,
    frontierDeduplicator,
    isCancelled: context.isCancelled,
    navigationBatch: details => navigation.beginBatch(details),
    navigationCancellation: cancelled => navigation.observeCancellation(cancelled),
    reportProgress: progress => context.reportProgress({ ...progress, cursor: navigation.observeProgress(progress.cursor) }),
  });
  return {
    ...result,
    navigation: navigation.complete(result),
    placements: Array.isArray(result?.placements) ? result.placements : [],
    hasPlacement: Array.isArray(result?.placements) && result.placements.length > 0,
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
  if (message?.type === 'start' || message?.type === 'cancel') {
    void protocolHandle(message);
    return;
  }
  try {
      void search(message?.pieces, message?.knownCentroidFamilies || [], { ...message, candidatePrefilter, frontierValidator, frontierEvaluator, frontierGenerator, frontierTargetGenerator, frontierTargetPool, frontierCandidateRecords, frontierScorer, frontierMetrics, fieldMetrics, frontierState, frontierTopology, frontierRanker, frontierDeduplicator })
      .then(result => self.postMessage(result))
      .catch(error => self.postMessage({ type: 'done', placements: null, metrics: null, nodes: 0, error: error.message }));
  } catch (error) {
    self.postMessage({ type: 'done', placements: null, metrics: null, nodes: 0, error: error.message });
  }
};
