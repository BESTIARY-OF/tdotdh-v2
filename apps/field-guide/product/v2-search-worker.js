import { installCpuWorker } from '../../../packages/search-worker/src/cpu-worker-entry.js';
import { createWebGpuCandidatePrefilter } from '../../../packages/search-core/src/webgpu-candidate-prefilter.js';
import { createWebGpuFrontierValidator } from '../../../packages/search-core/src/webgpu-frontier-validator.js';
import { createWebGpuFrontierEvaluator } from '../../../packages/search-core/src/webgpu-frontier-evaluator.js?v=20260811-maskcache2';
import { createWebGpuFrontierGenerator } from '../../../packages/search-core/src/webgpu-frontier-generator.js?v=20260811-pipelinecache1';
import { createWebGpuFrontierTargetGenerator } from '../../../packages/search-core/src/webgpu-frontier-target-generator.js?v=20260812-targetcopy1';
import { createWebGpuFrontierTargetPool } from '../../../packages/search-core/src/webgpu-frontier-target-pool.js?v=20260811-resident2';
import { createWebGpuFrontierMetrics } from '../../../packages/search-core/src/webgpu-frontier-metrics.js?v=20260812-sparsebits2';
import { createWebGpuFieldMetrics } from '../../../packages/search-core/src/webgpu-field-metrics.js?v=20260812-availabilitycache1';
import { createWebGpuLabeledFrontierState } from '../../../packages/search-core/src/webgpu-labeled-frontier-state.js?v=20260810-state3';
import { createWebGpuFrontierTopology } from '../../../packages/search-core/src/webgpu-frontier-topology.js?v=20260812-topoprofile2';
import { createWebGpuFrontierRanker } from '../../../packages/search-core/src/webgpu-frontier-ranker.js?v=20260811-gpu9';
import { createWebGpuPersistentFrontierCompactor } from '../../../packages/search-core/src/webgpu-frontier-compactor.js?v=20260811-pipelinecache1';
import { createWebGpuResidentBeamSelector } from '../../../packages/search-core/src/webgpu-resident-beam-selector.js?v=20260811-beam4';
import { createWebGpuFrontierDeduplicator } from '../../../packages/search-core/src/webgpu-frontier-deduplicator.js?v=20260812-dedupsubmit1';
import { createWebGpuFrontierNavigator } from '../../../packages/search-core/src/webgpu-frontier-navigator.js?v=20260811-digest1';
import { createWebGpuResidentFrontierState } from '../../../packages/search-core/src/webgpu-resident-frontier-state.js?v=20260812-availabilitycache1';
import { createWebGpuFrontierCandidateRecords } from '../../../packages/search-core/src/webgpu-frontier-candidate-records.js?v=20260811-resident2';
import { createWebGpuFrontierScorer } from '../../../packages/search-core/src/webgpu-frontier-scorer.js?v=20260811-pipelinecache1';
import { createWebGpuFrontierNavigationScheduler } from '../../../packages/search-core/src/webgpu-frontier-navigation-plan.js?v=20260811-resident25';
import { createWebGpuDeviceCache } from '../../../packages/search-core/src/webgpu-device-cache.js?v=20260811-lifecycle1';
import { probeWebGpuExecutionCapabilities } from '../../../packages/search-core/src/webgpu-execution-probe.js?v=20260810-gpu35';
import { createNavigationCoordinator } from '../../../packages/search-worker/src/navigation-coordinator.js?v=20260811-gpu-expansion4';
import { search } from './v2-legacy-search.js?v=20260812-neighbortarget1';

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
const residentDeviceCache = createWebGpuDeviceCache({
  gpu: globalThis.navigator?.gpu,
  requiredLimits: { maxStorageBufferBindingSize: 33554432, maxStorageBuffersPerShaderStage: 14 },
});
const residentFrontierState = createWebGpuResidentFrontierState({ gpu: globalThis.navigator?.gpu, deviceCache: residentDeviceCache });
const frontierCandidateRecords = createWebGpuFrontierCandidateRecords({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierScorer = createWebGpuFrontierScorer({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierTopology = createWebGpuFrontierTopology({ gpu: globalThis.navigator?.gpu });
const frontierRanker = createWebGpuFrontierRanker({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierCompactor = createWebGpuPersistentFrontierCompactor({ gpu: globalThis.navigator?.gpu, deviceCache });
const residentBeamSelector = createWebGpuResidentBeamSelector({ gpu: globalThis.navigator?.gpu, deviceCache });
const frontierDeduplicator = createWebGpuFrontierDeduplicator({ gpu: globalThis.navigator?.gpu, deviceCache: residentDeviceCache });
const frontierNavigationScheduler = createWebGpuFrontierNavigationScheduler({ gpu: globalThis.navigator?.gpu, deviceCache });
const gpuStageAdapters = Object.freeze({ prefilter: candidatePrefilter, frontier: frontierEvaluator, frontierGeneration: frontierGenerator, frontierTargetGeneration: frontierTargetGenerator, frontierCandidateRecords, frontierTargetPool, frontierMetrics, fieldMetrics, frontierState, frontierTopology, frontierRanker, frontierCompactor, frontierDedup: frontierDeduplicator, frontierScore: frontierScorer, navigationPlan: frontierNavigationScheduler });
let gpuStageAvailabilityPromise = null;
async function getGpuStageAvailability() {
  if (!gpuStageAvailabilityPromise) gpuStageAvailabilityPromise = Promise.all(Object.entries(gpuStageAdapters).map(async ([name, adapter]) => [name, adapter?.availability ? await adapter.availability() : { status: 'unavailable', reason: 'stage-does-not-expose-availability' }])).then(entries => Object.freeze(Object.fromEntries(entries)));
  return gpuStageAvailabilityPromise;
}
async function runGpuProbe() {
  const gpuExecution = await probeWebGpuExecutionCapabilities({ gpu: globalThis.navigator?.gpu, requiredLimits: { maxStorageBufferBindingSize: 33554432 }, deviceCache });
  return { type: 'gpu-probe', gpuExecution, stageAvailability: await getGpuStageAvailability(), workerNavigatorGpu: typeof globalThis.navigator?.gpu !== 'undefined' };
}
async function runProductSearchSingle(request, context) {
  const startedAt = performance.now();
  const steering = request.steering || {};
  const batchMode = steering.batchMode === true;
  const benchmarkBackend = steering.benchmarkBackend === 'cpu' || steering.benchmarkBackend === 'gpu'
    ? steering.benchmarkBackend
    : null;
  const forceCpuBenchmark = benchmarkBackend === 'cpu';
  const taskResidentFrontierState = batchMode
    ? createWebGpuResidentFrontierState({ gpu: globalThis.navigator?.gpu, deviceCache: residentDeviceCache, resetDeviceCache: false })
    : residentFrontierState;
  if (!batchMode) taskResidentFrontierState.reset();
  const gpuExecution = forceCpuBenchmark
    ? { deviceAvailable: false, reason: 'benchmark-forced-cpu', stageAvailability: {} }
    : await probeWebGpuExecutionCapabilities({ gpu: globalThis.navigator?.gpu, requiredLimits: { maxStorageBufferBindingSize: 33554432 }, deviceCache });
  const navigation = createNavigationCoordinator({ ticket: request.ticket, cursor: request.cursor });
  const frontierNavigator = createWebGpuFrontierNavigator({ stateAdapter: taskResidentFrontierState, ticket: request.ticket, cursor: request.cursor, isCancelled: context.isCancelled });
  let executionDecision = null;
  const stageTimings = Object.create(null);
  const timedStage = (name, adapter) => {
    if (!adapter) return null;
    const wrapped = Object.create(Object.getPrototypeOf(adapter));
    const seen = new Set();
    const wrapMethod = (property, value) => async (...args) => {
      const started = performance.now();
      try {
        return await value.apply(adapter, args);
      } finally {
        const timing = stageTimings[name] || (stageTimings[name] = { calls: 0, totalMs: 0, maxMs: 0, methods: {} });
        const elapsedMs = performance.now() - started;
        const methodName = String(property);
        const method = timing.methods[methodName] || (timing.methods[methodName] = { calls: 0, totalMs: 0, maxMs: 0 });
        timing.calls += 1;
        timing.totalMs += elapsedMs;
        timing.maxMs = Math.max(timing.maxMs, elapsedMs);
        method.calls += 1;
        method.totalMs += elapsedMs;
        method.maxMs = Math.max(method.maxMs, elapsedMs);
      }
    };
    for (let current = adapter; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
      for (const property of Reflect.ownKeys(current)) {
        if (seen.has(property) || property === 'constructor') continue;
        seen.add(property);
        const descriptor = Reflect.getOwnPropertyDescriptor(current, property);
        if (!descriptor) continue;
        if ('value' in descriptor && typeof descriptor.value === 'function') {
          Object.defineProperty(wrapped, property, { value: wrapMethod(property, descriptor.value), writable: true, configurable: true, enumerable: descriptor.enumerable });
        } else if (current === adapter) {
          Object.defineProperty(wrapped, property, descriptor);
        }
      }
    }
    return wrapped;
  };
  const stageAvailability = forceCpuBenchmark ? {} : await getGpuStageAvailability();
  const stage = (name, adapter = gpuStageAdapters[name]) => forceCpuBenchmark ? null : timedStage(name, adapter);
  const result = await search(request.pieces, steering.knownCentroidFamilies || [], {
    ...steering,
    // Keep resident candidate data on-device during production search. The final
    // canonical replay remains the CPU correctness boundary; the diagnostic
    // verify-resident-navigation mode opts back into per-depth readback.
    verifyGpuResidentNavigation: steering.verifyGpuResidentNavigation === true,
    // Intermediate resident transitions carry GPU digests only. The search
    // loop enables full CPU canonical-label parity for the terminal layer;
    // callers can opt into per-depth parity for diagnostics.
    verifyGpuTransitionParity: steering.verifyGpuTransitionParity === true,
    enableGpuResidentDigestConsumer: steering.enableGpuResidentDigestConsumer !== false,
    // The CPU frontier coordinates are a small control-plane input. When GPU
    // target generation is available, recomputing the identical 64x64 target
    // pool and reading it back only adds a synchronization barrier; candidate
    // generation and resident navigation remain GPU-owned.
    skipRedundantGpuTargetPool: steering.skipRedundantGpuTargetPool !== false,
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
    frontierCandidateRecords: stage('frontierCandidateRecords', frontierCandidateRecords),
    frontierScorer: stage('frontierScore'),
    frontierMetrics: stage('frontierMetrics'),
    fieldMetrics: stage('fieldMetrics'),
    frontierState: stage('frontierState', taskResidentFrontierState),
    frontierNavigator: forceCpuBenchmark ? null : timedStage('frontierState', frontierNavigator),
    frontierTopology: stage('frontierTopology'),
    frontierRanker: stage('frontierRanker'),
    frontierCompactor: stage('frontierCompactor'),
    residentBeamSelector: forceCpuBenchmark ? null : timedStage('frontierScore', residentBeamSelector),
    frontierDeduplicator: stage('frontierDedup'),
    navigationScheduler: gpuExecution.deviceAvailable ? timedStage('navigationPlan', frontierNavigationScheduler) : createWebGpuFrontierNavigationScheduler({ gpu: null }),
    isCancelled: context.isCancelled,
    navigationBatch: details => navigation.beginBatch(details),
    navigationCancellation: cancelled => navigation.observeCancellation(cancelled),
    reportProgress: progress => context.reportProgress({ ...progress, cursor: navigation.observeProgress(progress.cursor) }),
    reportExecutionDecision: decision => { executionDecision = decision; },
  });
  return {
    ...result,
    gpuExecution: { ...gpuExecution, stageAvailability },
    stageTimings,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    navigation: navigation.complete({ ...result, gpuExecution }),
    placements: Array.isArray(result?.placements) ? result.placements : [],
    hasPlacement: Array.isArray(result?.placements) && result.placements.length > 0,
    benchmarkBackend,
    executionDecision,
    protocolOperation: 'product-search',
    ...(batchMode ? { batchMode: true } : {}),
  };
}

async function runProductSearch(request, context) {
  const plan = Array.isArray(request.steering?.familyWorkPlan)
    ? request.steering.familyWorkPlan.filter(task => task && task.familyId && task.seed).slice(0, 32)
    : [];
  if (plan.length < 2) return runProductSearchSingle(request, context);
  const startedAt = performance.now();
  const results = await Promise.all(plan.map((task, index) => {
    const taskRequest = {
      ...request,
      requestId: `${request.requestId}:family-${index}`,
      ticket: { ...request.ticket, familyId: task.familyId, threadId: Number(task.threadIndex) || 0 },
      cursor: { ...request.cursor, rootChoice: Number(task.threadIndex) || 0 },
      steering: { ...request.steering, batchMode: true, familyWorkPlan: null, targetFamily: task.familyId, targetSeed: task.seed, familyWeight: Number(task.weight) || 1 },
    };
    return runProductSearchSingle(taskRequest, context).then(result => ({
      taskId: task.taskId || `${task.familyId}:${task.threadIndex}`,
      familyId: task.familyId,
      threadIndex: Number(task.threadIndex) || 0,
      weight: Number(task.weight) || 1,
      nodes: Number(result?.nodes) || 0,
      placements: Array.isArray(result?.placements) ? result.placements : [],
      metrics: result?.metrics || null,
      elapsedMs: Number(result?.elapsedMs) || 0,
      stageTimings: result?.stageTimings || null,
      gpuExecution: result?.gpuExecution || null,
      stageReceipts: Object.fromEntries(['prefilter', 'frontier', 'frontierGeneration', 'frontierTargetGeneration', 'frontierTargetPool', 'frontierMetrics', 'fieldMetrics', 'frontierState', 'frontierTopology', 'frontierRanker', 'frontierScore', 'frontierCompactor', 'frontierDedup', 'navigationPlan'].filter(name => result?.[name]).map(name => [name, result[name]])),
    }));
  }));
  const completed = results.filter(result => result.placements.length);
  const best = completed[0] || results[0];
  const isGpuReceipt = receipt => ['used', 'resident', 'completed'].includes(receipt?.status) && ['webgpu', 'compute-shader', 'resident-webgpu'].includes(receipt?.backend);
  const batchGpuStages = [...new Set(results.flatMap(result => Object.entries(result.stageReceipts || {}).filter(([, receipt]) => isGpuReceipt(receipt)).map(([name]) => name)))];
  const batchElapsedMs = performance.now() - startedAt;
  const taskElapsedMs = results.reduce((sum, result) => sum + result.elapsedMs, 0);
  const longestTaskMs = Math.max(0, ...results.map(result => result.elapsedMs));
  return {
    ...best,
    type: 'done',
    nodes: results.reduce((sum, result) => sum + result.nodes, 0),
    familyBatch: { schema: 'tdotdh.v2.family-work-grid.v0', status: 'used', backend: best.gpuExecution?.deviceAvailable ? 'webgpu' : 'cpu-oracle', parallel: true, residency: 'task-scoped-gpu-resident', gpuStages: batchGpuStages, taskCount: results.length, completedTaskCount: completed.length, elapsedMs: Number(batchElapsedMs.toFixed(2)), taskElapsedMs: Number(taskElapsedMs.toFixed(2)), longestTaskMs: Number(longestTaskMs.toFixed(2)), overlapFactor: batchElapsedMs > 0 ? Number((taskElapsedMs / batchElapsedMs).toFixed(3)) : 0, familyCount: new Set(results.map(result => result.familyId)).size, weightSlots: results.reduce((sum, result) => sum + result.weight, 0) },
    familyBatchResults: results,
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
