import { CANONICAL_SCHEMA, DISPLAY_SCHEMA } from '../../domain/src/display-geometry.js';

export const RENDERER_SCHEMA = 'tdotdh.renderer-boundary/v0';
export const RENDERER_BACKENDS = Object.freeze({ canvas2d: 'canvas2d', webgpu: 'webgpu' });

function unavailable(reason = 'renderer-backend-unavailable') {
  return Object.freeze({
    schema: RENDERER_SCHEMA,
    status: 'unavailable',
    backend: null,
    reason: String(reason),
  });
}

function requireGeometry(geometry) {
  if (!geometry || geometry.schema !== DISPLAY_SCHEMA) {
    throw new TypeError(`renderer requires ${DISPLAY_SCHEMA} geometry`);
  }
  if (geometry.canonical?.schema !== CANONICAL_SCHEMA || geometry.canonical.authoritative !== true) {
    throw new TypeError('renderer requires authoritative canonical flatland geometry');
  }
  return geometry;
}

function requireCells(cells) {
  if (!Array.isArray(cells) || cells.length === 0) throw new TypeError('renderer requires at least one flatland cell');
  for (const cell of cells) {
    if (!Number.isInteger(cell?.x) || !Number.isInteger(cell?.y)) {
      throw new TypeError('renderer cells must use integer canonical coordinates');
    }
  }
  return cells.map(({ x, y }) => Object.freeze({ x, y }));
}

export function createRendererRequest({ geometry, cells, viewport = null } = {}) {
  const canonicalGeometry = requireGeometry(geometry);
  return Object.freeze({
    schema: RENDERER_SCHEMA,
    status: 'ready',
    source: Object.freeze({
      schema: CANONICAL_SCHEMA,
      geometry: canonicalGeometry.canonical.geometry,
      cells: Object.freeze(requireCells(cells)),
    }),
    target: Object.freeze({ ...canonicalGeometry.target }),
    viewport: viewport == null ? null : Object.freeze({ ...viewport }),
    policy: 'backend may accelerate rendering but must not rewrite canonical coordinates',
  });
}

export function createRendererBoundary({ backend = null, execute = null } = {}) {
  if (backend !== null && !Object.values(RENDERER_BACKENDS).includes(backend)) {
    throw new TypeError(`unsupported renderer backend: ${backend}`);
  }
  if (execute !== null && typeof execute !== 'function') throw new TypeError('renderer execute must be a function');
  return Object.freeze({
    availability() {
      return backend === null ? unavailable() : Object.freeze({ schema: RENDERER_SCHEMA, status: 'available', backend });
    },
    async render(request) {
      if (backend === null || execute === null) return unavailable();
      requireGeometry({ schema: DISPLAY_SCHEMA, canonical: { schema: CANONICAL_SCHEMA, authoritative: true }, target: request.target });
      return execute(request);
    },
  });
}
