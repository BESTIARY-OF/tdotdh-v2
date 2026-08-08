import assert from 'node:assert/strict';
import { createDisplayGeometry } from '../../domain/src/display-geometry.js';
import {
  createRendererBoundary,
  createRendererRequest,
  RENDERER_SCHEMA,
} from '../src/renderer-boundary.js';

const geometry = createDisplayGeometry({ kind: 'flatland', dimension: 2 });
const request = createRendererRequest({
  geometry,
  cells: [{ x: 2, y: 1 }, { x: 0, y: 0 }],
  viewport: { width: 640, height: 480 },
});

assert.equal(request.schema, RENDERER_SCHEMA);
assert.equal(request.source.schema, 'tdotdh.canonical-flatland/v0');
assert.deepEqual(request.source.cells, [{ x: 2, y: 1 }, { x: 0, y: 0 }]);
assert.equal(request.target.implementation, 'metadata-only');

const unavailable = createRendererBoundary();
assert.deepEqual(unavailable.availability(), {
  schema: RENDERER_SCHEMA,
  status: 'unavailable',
  backend: null,
  reason: 'renderer-backend-unavailable',
});
assert.deepEqual(await unavailable.render(request), unavailable.availability());

assert.throws(() => createRendererRequest({ geometry, cells: [{ x: 0.5, y: 0 }] }), /integer canonical/);
assert.throws(() => createRendererBoundary({ backend: 'invented' }), /unsupported renderer backend/);

console.log('renderer boundary tests passed');
