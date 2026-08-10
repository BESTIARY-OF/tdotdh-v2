import { PROJECTION_TARGETS } from '../../interchange/src/projection-transform-vocabulary.js';

export const RENDERER_ADAPTER_SCHEMA = 'tdotdh.renderer-adapter-capability.v1';
export const IMPLEMENTED_PROJECTION = 'flatland';
export const FUTURE_PROJECTIONS = Object.freeze(['sphere', 'hypersphere', 'cube', 'hypercube', 'simplex']);

function hasWebGpu(runtime) {
  return Boolean(runtime?.navigator?.gpu);
}

function copyCanonicalCells(cells) {
  if (!Array.isArray(cells) || cells.length === 0) {
    throw new TypeError('flatland cells must be a non-empty array');
  }
  return cells.map(cell => {
    if (!Number.isInteger(cell?.x) || !Number.isInteger(cell?.y)) {
      throw new TypeError('flatland cells must use integer canonical coordinates');
    }
    return Object.freeze({ x: cell.x, y: cell.y });
  });
}

export function createRendererAdapter({ runtime = globalThis } = {}) {
  const webgpu = hasWebGpu(runtime);
  const projectionStatus = Object.freeze({
    flatland: 'implemented',
    ...Object.fromEntries(FUTURE_PROJECTIONS.map(name => [name, 'vocabulary-only']))
  });

  return Object.freeze({
    capabilities: Object.freeze({
      schema: RENDERER_ADAPTER_SCHEMA,
      backend: webgpu ? 'webgpu' : null,
      status: webgpu ? 'available' : 'unavailable',
      reason: webgpu ? null : 'webgpu-unavailable',
      projections: projectionStatus
    }),

    flatland(cells) {
      const canonicalCells = copyCanonicalCells(cells);
      if (!webgpu) {
        return Object.freeze({
          schema: RENDERER_ADAPTER_SCHEMA,
          status: 'unavailable',
          backend: null,
          projection: IMPLEMENTED_PROJECTION,
          reason: 'webgpu-unavailable',
          cells: canonicalCells
        });
      }
      return Object.freeze({
        schema: RENDERER_ADAPTER_SCHEMA,
        status: 'available',
        backend: 'webgpu',
        projection: IMPLEMENTED_PROJECTION,
        cells: canonicalCells,
        policy: 'canonical coordinates are copied, never rewritten'
      });
    },

    futureProjection(name) {
      if (!FUTURE_PROJECTIONS.includes(name) || !PROJECTION_TARGETS[name]) {
        throw new TypeError(`unsupported future projection: ${name}`);
      }
      return Object.freeze({
        schema: RENDERER_ADAPTER_SCHEMA,
        status: 'vocabulary-only',
        backend: null,
        projection: name,
        reason: 'future-renderer-unimplemented'
      });
    }
  });
}
