import { createDisplayGeometry } from '../../../packages/domain/src/display-geometry.js';
import { createRendererRequest } from '../../../packages/browser-handoff/src/renderer-boundary.js';
import { createCpuOracleFirstAdapter } from '../../../packages/search-core/src/compute-adapter.js';

const geometry = createDisplayGeometry({ kind: 'flatland', dimension: 2 });
const cpuOracle = async request => ({
  canonicalSignature: request.deterministicKey,
  placements: null,
});
const cpuOracleFirst = createCpuOracleFirstAdapter({
  cpuOracle,
  unavailableReason: 'compute-shader-backend-not-yet-implemented',
});

window.__TDOTDH_V2_RUNTIME__ = Object.freeze({
  product: 'nonomino-field-guide',
  dataPack: 'SEDLEC-00Q_ISLAND-001',
  geometry,
  cpuOracleFirst,
  rendererRequest: cells => createRendererRequest({ geometry, cells }),
  acceleration: cpuOracleFirst.availability(),
});

const status = document.querySelector('#v2RuntimeStatus');
if (status) {
  status.textContent = 'V2 product · CPU oracle active · compute shader unavailable';
  status.title = 'The product uses the real field-guide worker and data pack. GPU search remains gated on canonical parity.';
  status.dataset.backend = 'cpu-oracle';
}
