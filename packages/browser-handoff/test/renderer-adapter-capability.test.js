import assert from 'node:assert/strict';
import {
  FUTURE_PROJECTIONS,
  IMPLEMENTED_PROJECTION,
  RENDERER_ADAPTER_SCHEMA,
  createRendererAdapter,
} from '../src/renderer-adapter-capability.js';

const cells = [{ x: 4, y: 2 }, { x: 0, y: 0 }];
const unavailable = createRendererAdapter({ runtime: {} });

assert.equal(unavailable.capabilities.schema, RENDERER_ADAPTER_SCHEMA);
assert.equal(unavailable.capabilities.status, 'unavailable');
assert.equal(unavailable.capabilities.backend, null);
assert.equal(unavailable.capabilities.reason, 'webgpu-unavailable');
assert.equal(unavailable.capabilities.projections[IMPLEMENTED_PROJECTION], 'implemented');
assert.deepEqual(unavailable.flatland(cells), {
  schema: RENDERER_ADAPTER_SCHEMA,
  status: 'unavailable',
  backend: null,
  projection: 'flatland',
  reason: 'webgpu-unavailable',
  cells,
});

const available = createRendererAdapter({ runtime: { navigator: { gpu: {} } } });
const rendered = available.flatland(cells);
assert.equal(rendered.status, 'available');
assert.deepEqual(rendered.cells, cells);
assert.notStrictEqual(rendered.cells, cells);
assert.equal(rendered.policy, 'canonical coordinates are copied, never rewritten');

for (const projection of FUTURE_PROJECTIONS) {
  assert.equal(available.capabilities.projections[projection], 'vocabulary-only');
  assert.equal(available.futureProjection(projection).status, 'vocabulary-only');
}

assert.throws(() => available.futureProjection('torus'), /unsupported future projection/);
assert.throws(() => available.flatland([{ x: 1.5, y: 0 }]), /integer canonical coordinates/);

console.log('renderer adapter capability tests passed');
