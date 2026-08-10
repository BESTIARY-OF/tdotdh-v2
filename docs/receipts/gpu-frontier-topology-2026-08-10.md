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
WebGPU is available. The hardware path flattens candidate×word occupancy and
candidate×cell label buffers into shared dispatches; CPU-oracle and benchmark
adapters short-circuit the batch path so they do not pay a false acceleration
penalty.

## Frontier expansion batch

The navigation loop now calls the generator's `generateBatch` operation once per
beam state for all remaining pieces. Its flattened WebGPU dispatch covers the
field-frontier × direction × source-cell product for every piece, returns
per-piece validity/origin slices, and is accepted only after exact CPU-oracle
parity. CPU-only adapters retain their existing per-piece behavior and the
search receipt reports `batch: verified` only for the hardware batch path.

Verification:

- `node packages/search-core/test/webgpu-frontier-topology.test.js`
- `node apps/field-guide/test/v2-search-receipt.test.js`
- `npm run check:frontier-topology`
- `npm run bench:v2:product-search`
