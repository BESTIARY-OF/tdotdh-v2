import { createDisplayGeometry } from '../../../packages/domain/src/display-geometry.js';
import { createRendererRequest } from '../../../packages/browser-handoff/src/renderer-boundary.js';
import { createRendererAdapter } from '../../../packages/browser-handoff/src/renderer-adapter-capability.js';
import { createCpuOracleFirstAdapter } from '../../../packages/search-core/src/compute-adapter.js';
import { createWebGpuCandidateScorer, cpuCandidateScores } from '../../../packages/search-core/src/webgpu-candidate-scorer.js';
import { createWebGpuCandidatePrefilter, cpuCandidatePrefilter } from '../../../packages/search-core/src/webgpu-candidate-prefilter.js';

const geometry = createDisplayGeometry({ kind: 'flatland', dimension: 2 });
const rendererAdapter = createRendererAdapter();
const cpuOracle = async request => ({
  canonicalSignature: request.deterministicKey,
  placements: null,
});
const cpuOracleFirst = createCpuOracleFirstAdapter({
  cpuOracle,
  unavailableReason: 'compute-shader-backend-not-yet-implemented',
});

const workerUrl = new URL('./v2-search-worker.js', import.meta.url);
const cpuWorker = new Worker(workerUrl, { type: 'module' });
const gpuScorer = createWebGpuCandidateScorer();
const gpuCandidatePrefilter = createWebGpuCandidatePrefilter();

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
  gpuCandidatePrefilter,
  runCandidateParity,
  rendererAdapter,
  workerUrl: workerUrl.href,
  rendererRequest: cells => createRendererRequest({ geometry, cells }),
  acceleration: cpuOracleFirst.availability(),
});

const status = document.querySelector('#v2RuntimeStatus');
if (status) {
  status.textContent = 'V2 product · CPU oracle active · compute shader unavailable';
  status.title = 'The product uses the real field-guide worker and data pack. GPU search remains gated on canonical parity.';
  status.dataset.backend = 'cpu-oracle';
}

cpuWorker.addEventListener('message', event => {
  if (event.data?.type !== 'started') return;
  if (status) status.textContent = 'V2 product · CPU oracle worker wired · compute shader unavailable';
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

void gpuScorer.availability().then(async capability => {
  if (capability.status !== 'available') return;
  const values = [0, 1, 17, 255];
  const gpuResult = await gpuScorer.score(values);
  const parity = gpuResult.status === 'completed' && JSON.stringify(gpuResult.scores) === JSON.stringify(cpuCandidateScores(values));
  if (!parity || !status) return;
  const candidates = [
    [{ pieceId: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }],
    [{ pieceId: 2, cells: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }],
  ];
  const prefilterResult = await gpuCandidatePrefilter.prefilter(candidates);
  const prefilterParity = prefilterResult.status === 'completed'
    && JSON.stringify(prefilterResult.validity) === JSON.stringify(cpuCandidatePrefilter(candidates).validity);
  status.textContent = prefilterParity
    ? 'V2 product · WebGPU parity gates loaded · search still CPU-oracle'
    : 'V2 product · WebGPU candidate parity failed · CPU oracle active';
}).catch(() => {});
