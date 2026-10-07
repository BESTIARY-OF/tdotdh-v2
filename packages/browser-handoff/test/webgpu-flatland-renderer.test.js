import assert from 'node:assert/strict';
import { createWebGpuFlatlandRenderer, WEBGPU_FLATLAND_RENDERER_SCHEMA } from '../src/webgpu-flatland-renderer.js';

const renderer = createWebGpuFlatlandRenderer({ runtime: { navigator: {} } });
assert.equal(renderer.schema, WEBGPU_FLATLAND_RENDERER_SCHEMA);
assert.deepEqual(await renderer.availability(), {
  schema: WEBGPU_FLATLAND_RENDERER_SCHEMA,
  status: 'unavailable',
  backend: null,
  projection: 'flatland',
  reason: 'webgpu-unavailable',
});
assert.deepEqual(await renderer.render({ canvas: null, cells: [{ x: 0, y: 0, color: '#ffffff' }] }), {
  schema: WEBGPU_FLATLAND_RENDERER_SCHEMA,
  status: 'unavailable',
  backend: null,
  projection: 'flatland',
  reason: 'canvas-unavailable',
});
await assert.rejects(() => renderer.render({ canvas: null, cells: [{ x: 0.5, y: 0 }] }), /integer canonical/);
console.log('WebGPU flatland renderer tests passed');
