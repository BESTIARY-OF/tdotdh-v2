# v2 WebGPU flatland render pass — 2026-08-12

## Implementation

Added a real WebGPU flatland renderer behind the browser-handoff boundary. It draws the authoritative integer cell coordinates and piece colors into a transparent canvas overlay while retaining the DOM grid underneath for interaction and fallback. No future projection backend was invented; sphere, hypersphere, cube, hypercube, and simplex remain vocabulary-only.

The runtime-ready event fixes module-order initialization: persisted fields rerender after the v2 runtime publishes the renderer, instead of permanently dropping the overlay during the initial app render.

## Verification

- Live URL: `http://127.0.0.1:5174/?v=20260812-webgpu-flatland2`
- Persisted SEDLEC field after refresh: one board canvas present
- Canvas status: `rendered`
- Runtime search status: `GPU smoke parity verified`
- Focused checks passed:
  - `node packages/browser-handoff/test/webgpu-flatland-renderer.test.js`
  - `node packages/browser-handoff/test/renderer-boundary.test.js`
  - `node packages/browser-handoff/test/renderer-adapter-capability.test.js`
  - `node apps/field-guide/test/product-bundle.test.js`
  - `node apps/field-guide/test/v2-search-receipt.test.js`
  - `node apps/field-guide/test/v2-search-cancellation.test.js`
  - `node apps/field-guide/test/v2-worker-runtime.test.mjs`

The DOM grid remains authoritative for accessibility and interaction; the WebGPU overlay is the accelerated display path when the browser exposes a usable device, and it is removed on explicit renderer failure.
