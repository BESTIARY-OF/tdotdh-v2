import { createDisplayGeometry } from '../../../packages/domain/src/display-geometry.js';
import { createRendererRequest } from '../../../packages/browser-handoff/src/renderer-boundary.js';
import { createRendererAdapter } from '../../../packages/browser-handoff/src/renderer-adapter-capability.js';
import { createCpuOracleFirstAdapter } from '../../../packages/search-core/src/compute-adapter.js';
import { createWebGpuDeviceCache } from '../../../packages/search-core/src/webgpu-device-cache.js';
import { probeWebGpuExecutionCapabilities } from '../../../packages/search-core/src/webgpu-execution-probe.js?v=20260810-gpu35';
import { createWebGpuCandidateScorer, cpuCandidateScores } from '../../../packages/search-core/src/webgpu-candidate-scorer.js';
import { createWebGpuCandidatePrefilter, cpuCandidatePrefilter } from '../../../packages/search-core/src/webgpu-candidate-prefilter.js';
import { createWebGpuFrontierTargetPool, cpuGenerateFrontierTargetPoolBatch } from '../../../packages/search-core/src/webgpu-frontier-target-pool.js';
import { createWebGpuFrontierDeduplicator, cpuDeduplicateFrontierStates } from '../../../packages/search-core/src/webgpu-frontier-deduplicator.js';

const geometry = createDisplayGeometry({ kind: 'flatland', dimension: 2 });
const rendererAdapter = createRendererAdapter();
const rendererCapabilities = rendererAdapter.capabilities;
const rendererBoundarySummary = `Renderer boundary: flatland=${rendererCapabilities.projections.flatland}; backend=${rendererCapabilities.backend || 'unavailable'}; sphere/hypersphere/cube/hypercube/simplex=vocabulary-only.`;
const rendererBoundaryTitle = detail => `${detail} ${rendererBoundarySummary}`;
const cpuOracle = async request => ({
  canonicalSignature: request.deterministicKey,
  placements: null,
});
const cpuOracleFirst = createCpuOracleFirstAdapter({
  cpuOracle,
  unavailableReason: 'compute-shader-backend-not-yet-implemented',
});

const workerUrl = new URL('./v2-search-worker.js?v=20260812-metrictiming1', import.meta.url);
const cpuWorker = new Worker(workerUrl, { type: 'module' });
async function probeProductWorker() {
  const worker = new Worker(workerUrl, { type: 'module' });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('worker GPU probe timed out')); }, 5000);
    worker.addEventListener('message', event => {
      if (event.data?.type !== 'gpu-probe' && event.data?.type !== 'gpu-probe-failed') return;
      clearTimeout(timer); worker.terminate();
      if (event.data.type === 'gpu-probe-failed') reject(new Error(event.data.error?.message || 'worker GPU probe failed'));
      else resolve(event.data);
    });
    worker.addEventListener('error', error => { clearTimeout(timer); worker.terminate(); reject(error); });
    worker.postMessage({ type: 'probe' });
  });
}
const gpuDeviceCache = createWebGpuDeviceCache();
const gpuScorer = createWebGpuCandidateScorer({ deviceCache: gpuDeviceCache });
const gpuCandidatePrefilter = createWebGpuCandidatePrefilter({ deviceCache: gpuDeviceCache });
const gpuFrontierTargetPool = createWebGpuFrontierTargetPool({ deviceCache: gpuDeviceCache });
const gpuFrontierDeduplicator = createWebGpuFrontierDeduplicator({ deviceCache: gpuDeviceCache });

async function runCandidateParity(candidates) {
  const cpu = cpuCandidatePrefilter(candidates);
  const gpu = await gpuCandidatePrefilter.prefilter(candidates);
  const parity = gpu.status === 'completed' && JSON.stringify(gpu.validity) === JSON.stringify(cpu.validity);
  return Object.freeze({
    status: parity ? 'parity-verified' : gpu.status === 'unavailable' ? 'unavailable' : 'parity-failed',
    cpu,
    gpu,
    parity,
  });
}

window.__TDOTDH_V2_RUNTIME__ = Object.freeze({
  product: 'nonomino-field-guide',
  dataPack: 'SEDLEC-00Q_ISLAND-001',
  geometry,
  cpuOracleFirst,
  cpuWorker,
  gpuScorer,
  gpuDeviceCache,
  gpuCandidatePrefilter,
  gpuFrontierTargetPool,
  gpuFrontierDeduplicator,
  runCandidateParity,
  rendererAdapter,
  rendererCapabilities,
  workerUrl: workerUrl.href,
  rendererRequest: cells => createRendererRequest({ geometry, cells }),
  acceleration: cpuOracleFirst.availability(),
});

const status = document.querySelector('#v2RuntimeStatus');
if (status) {
  status.textContent = 'V2 product · CPU oracle active · probing GPU navigation';
  status.title = rendererBoundaryTitle('Chrome graphics acceleration is not sufficient evidence by itself; this label changes only after the page dispatches navigation kernels and verifies CPU parity.');
  status.dataset.rendererBackend = rendererCapabilities.backend || 'unavailable';
  status.dataset.rendererProjection = 'flatland';
  status.dataset.backend = 'cpu-oracle';
}

cpuWorker.addEventListener('message', event => {
  if (event.data?.type !== 'started') return;
  if (status && status.dataset.backend !== 'webgpu') status.textContent = 'V2 product · CPU oracle worker wired · probing GPU navigation';
});

cpuWorker.postMessage({
  type: 'start',
  protocolVersion: 1,
  requestId: 'v2-runtime-smoke',
  presetFingerprint: 'runtime-smoke-v0',
  catalogRevision: 'tdotdh-v2-catalog-v0',
  seed: 'runtime-smoke-seed',
  ticket: { presetFingerprint: 'runtime-smoke-v0', familyId: 'F-0RHDG0U', pass: 0, threadId: 0 },
  cursor: { depth: 0, nodeOffset: 0, rootChoice: 0 },
  budget: { maxNodes: 1, maxMilliseconds: 1000 },
  pieces: [{ id: 1, cells: [{ x: 0, y: 0 }] }],
  constraints: { candidateArrangements: [[{ pieceId: 1, cells: [{ x: 0, y: 0 }] }]] },
  knownSignatureHints: [],
});

void probeProductWorker().then(probe => {
  window.__TDOTDH_V2_RUNTIME__ = Object.freeze({ ...window.__TDOTDH_V2_RUNTIME__, workerGpuProbe: probe });
  if (status) {
    status.dataset.workerGpu = probe.workerNavigatorGpu ? 'available' : 'unavailable';
    const unavailableStages = Object.entries(probe.stageAvailability || {}).filter(([, stage]) => stage?.status !== 'available').map(([name, stage]) => `${name}=${stage?.reason || stage?.status || 'unknown'}`);
    status.title = rendererBoundaryTitle(`Worker probe: ${probe.workerNavigatorGpu ? 'navigator.gpu exposed' : 'navigator.gpu unavailable'}; ${unavailableStages.length ? `stage availability: ${unavailableStages.join(', ')}` : 'all stages available'}.`);
  }
}).catch(error => {
  if (status) { status.dataset.workerGpu = 'probe-failed'; status.title = rendererBoundaryTitle(`Worker probe failed: ${error.message}`); }
});

void gpuScorer.availability().then(async capability => {
  if (capability.status !== 'available') {
    if (status) { status.textContent = `V2 product · CPU oracle active · WebGPU unavailable (${capability.reason || 'adapter unavailable'})`; status.title = rendererBoundaryTitle('This page did not obtain a usable WebGPU adapter. Chrome hardware acceleration can still be enabled independently.'); }
    return;
  }
  const execution = await probeWebGpuExecutionCapabilities({ deviceCache: gpuDeviceCache, requiredLimits: { maxStorageBufferBindingSize: 65536 } });
  window.__TDOTDH_V2_RUNTIME__ = Object.freeze({ ...window.__TDOTDH_V2_RUNTIME__, gpuExecution: execution });
  if (!execution.deviceAvailable) {
    if (status) { status.textContent = `V2 product · CPU oracle active · WebGPU unavailable (${execution.reason})`; status.title = rendererBoundaryTitle('The page exposed a WebGPU adapter but could not create a usable device, so accelerated search remains disabled.'); }
    return;
  }
  const values = [0, 1, 17, 255];
  const gpuResult = await gpuScorer.score(values);
  const parity = gpuResult.status === 'completed' && JSON.stringify(gpuResult.scores) === JSON.stringify(cpuCandidateScores(values));
  if (!parity || !status) {
    if (status) { status.textContent = 'V2 product · CPU oracle active · WebGPU scorer parity failed'; status.title = rendererBoundaryTitle('A WebGPU dispatch completed but did not match the CPU oracle, so the product refused to use it.'); }
    return;
  }
  const candidates = [
    [{ pieceId: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }],
    [{ pieceId: 2, cells: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }],
  ];
  const prefilterResult = await gpuCandidatePrefilter.prefilter(candidates);
  const prefilterParity = prefilterResult.status === 'completed'
    && JSON.stringify(prefilterResult.validity) === JSON.stringify(cpuCandidatePrefilter(candidates).validity);
  const targetPoolInput = [{
    stateId: 'runtime-smoke',
    fieldCells: [{ x: 0, y: 0 }],
    centroidCells: [{ x: 0, y: 0 }],
  }];
  const targetPoolResult = await gpuFrontierTargetPool.generateBatch(targetPoolInput);
  const targetPoolCpu = cpuGenerateFrontierTargetPoolBatch(targetPoolInput);
  const targetPoolParity = targetPoolResult.status === 'completed'
    && targetPoolResult.parity === 'verified'
    && JSON.stringify(targetPoolResult.items?.map(item => ({ frontierCells: item.frontierCells, ringCells: item.ringCells })))
      === JSON.stringify(targetPoolCpu.items.map(item => ({ frontierCells: item.frontierCells, ringCells: item.ringCells })));
  const dedupRows = [{ hash: 17, signature: 'runtime-a' }, { hash: 18, signature: 'runtime-b' }, { hash: 17, signature: 'runtime-a' }];
  const dedupResult = await gpuFrontierDeduplicator.deduplicate(dedupRows);
  const dedupCpu = cpuDeduplicateFrontierStates(dedupRows);
  const dedupParity = dedupResult.status === 'completed'
    && dedupResult.parity === 'verified'
    && JSON.stringify(dedupResult.keep) === JSON.stringify(dedupCpu.keep);
  if (prefilterParity && targetPoolParity && dedupParity) {
    status.textContent = 'V2 product · GPU smoke parity verified · real search receipt pending';
    status.title = rendererBoundaryTitle('Startup smoke kernels for scoring, occupancy prefiltering, target navigation, and deduplication matched the CPU oracle. This is capability evidence, not a full-search performance claim.');
    status.dataset.backend = 'webgpu';
  } else if (prefilterParity && targetPoolParity) {
    status.textContent = `V2 product · GPU target navigation verified · dedup unavailable (${dedupResult.reason || 'parity failed'})`;
    status.title = rendererBoundaryTitle('GPU scorer, occupancy prefilter, and target navigation passed parity, but frontier deduplication did not; the product kept CPU exact-signature admission in control.');
    status.dataset.backend = 'cpu-oracle';
  } else if (prefilterParity) {
    status.textContent = `V2 product · GPU scorer/prefilter verified · target navigation unavailable (${targetPoolResult.reason || 'parity failed'})`;
    status.title = rendererBoundaryTitle('GPU scorer and occupancy prefilter passed parity, but target navigation did not; the product kept the CPU oracle in control.');
    status.dataset.backend = 'cpu-oracle';
  } else {
    status.textContent = 'V2 product · CPU oracle active · GPU navigation parity failed';
    status.title = rendererBoundaryTitle('A GPU navigation dispatch did not match the CPU oracle, so the product refused to use the accelerated result.');
    status.dataset.backend = 'cpu-oracle';
  }
}).catch(() => {});
