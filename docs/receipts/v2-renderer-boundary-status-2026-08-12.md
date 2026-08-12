# v2 renderer boundary status — 2026-08-12

## Product integration

The v2 runtime now exposes the renderer adapter capability report and appends it to the status tooltip after every startup/probe outcome:

- `rendererBackend`: `webgpu` when the browser exposes `navigator.gpu`, otherwise `unavailable`
- `rendererProjection`: `flatland`
- flatland: `implemented`
- sphere, hypersphere, cube, hypercube, simplex: `vocabulary-only`

This is an explicit boundary/capability report. It does not claim that the current DOM/SVG field display is GPU-rendered; the display backend remains a separate renderer implementation milestone.

## Live verification

- URL: `http://127.0.0.1:5174/?v=20260812-rendererboundary1`
- Status text: `V2 product · GPU smoke parity verified · real search receipt pending`
- `rendererBackend=webgpu`
- `rendererProjection=flatland`
- Tooltip reports future projections as vocabulary-only

Focused checks passed:

- `node --check apps/field-guide/product/v2-runtime.js`
- `node packages/browser-handoff/test/renderer-adapter-capability.test.js`
- `node packages/browser-handoff/test/renderer-boundary.test.js`
