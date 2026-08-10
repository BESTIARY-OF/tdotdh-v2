# GPU frontier topology receipt — 2026-08-10

The product's final-arrangement path now calls
`tdotdh.webgpu-frontier-topology.v0`. The adapter forms the complete occupancy
union on the accelerator and performs a parallel word-level area reduction.
The returned occupancy mask and area must match the CPU oracle exactly before
the receipt is marked `parity: verified` and used for final acceptance.

The same adapter reports the CPU-oracle topology metrics needed by the existing
product contract: perimeter, holes, 4-neighbor connectivity, centroid edge and
corner coast, and bounding-box area. This is intentionally explicit: GPU union
and area are accelerated today, while component labeling and hole flooding are
the next GPU topology slice. A device failure or parity mismatch returns an
explicit CPU fallback/rejection and never changes SEDLEC acceptance semantics.

Verification:

- `node packages/search-core/test/webgpu-frontier-topology.test.js`
- `node apps/field-guide/test/v2-search-receipt.test.js`
- `npm run check:frontier-topology`
- `npm run bench:v2:product-search`
