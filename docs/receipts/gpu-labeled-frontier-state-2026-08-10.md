# GPU piece-labeled frontier state receipt — 2026-08-10

The v2 product now carries piece identity through its frontier-state adapter
using `tdotdh.webgpu-labeled-frontier-state.v0`. Each candidate transition
receives one occupancy mask per piece, the candidate piece index, and a fixed
remaining-piece mask. The adapter returns absolute labeled masks, translated
canonical labeled masks, and hashes for both forms.

The CPU implementation is the oracle. A WebGPU result is accepted only when
the complete labeled mask matrices and both hash vectors match the oracle. If
WebGPU is unavailable, the same receipt is returned with explicit fallback
status and the CPU result. The product uses the verified absolute labeled state
plus remaining mask as an exact beam-state key. It does not deduplicate on
aggregate occupancy or canonical labels alone, avoiding collisions between
different piece assignments and preserving translated search states.

Verification:

- `node packages/search-core/test/webgpu-labeled-frontier-state.test.js`
- `node apps/field-guide/test/v2-search-receipt.test.js`
- `npm run check:labeled-frontier-state`
- `npm run bench:v2:product-search`

The realistic SEDLEC-00Q benchmark still finds placements in breadth, depth,
and target-family modes. The in-app browser does not expose WebGPU, so its
runtime check validates the CPU fallback path; actual shader execution still
requires a browser/device with WebGPU enabled.
