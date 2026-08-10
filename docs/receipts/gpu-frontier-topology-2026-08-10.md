# GPU frontier topology receipt — 2026-08-10

The product's final-arrangement path now calls
`tdotdh.webgpu-frontier-topology.v0`. The adapter forms the complete occupancy
union on the accelerator and performs a parallel word-level area reduction.
The returned occupancy mask and area must match the CPU oracle exactly before
the receipt is accepted as the occupancy parity gate.

The same adapter runs iterative min-label propagation for occupied components
and empty regions. Connected-component and hole counts are derived from those
GPU labels, while perimeter, centroid edge/corner coast, and bounding-box area
remain CPU-oracle metrics. Occupancy, area, both label arrays, component count,
and hole count must match the CPU oracle exactly before the receipt is marked
`parity: labels-verified` and used for the GPU-derived label metrics. A device failure or parity
mismatch returns an explicit CPU fallback/rejection and never changes SEDLEC
acceptance semantics.

The adapter also exposes `evaluateBatch` for frontier navigation. The product
uses that contract to submit candidate frontiers in one GPU-oriented call when
WebGPU is available; CPU-oracle and benchmark adapters short-circuit the batch
path so they do not pay a false acceleration penalty.

Verification:

- `node packages/search-core/test/webgpu-frontier-topology.test.js`
- `node apps/field-guide/test/v2-search-receipt.test.js`
- `npm run check:frontier-topology`
- `npm run bench:v2:product-search`
