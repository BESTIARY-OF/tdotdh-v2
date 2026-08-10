# GPU field metrics receipt — 2026-08-10

The v2 search worker now exposes `tdotdh.webgpu-field-metrics.v0`.

- Input: one occupied mask and one centroid mask per surviving branch.
- GPU aggregate: area, perimeter, integer bounds, coordinate sums, centroid
  sums, centroid edge/corner coast flags, and exterior-masked inlet-cell/inlet-edge
  counts.
- Parity gate: the CPU oracle computes the same 15 integer values and rejects
  any divergent WebGPU result before the branch uses it.
- CPU-owned remainder: radius variance, quality weights, centroid family text/
  hash naming, hole flood semantics, persistence, and cancellation.
- Product receipt: `fieldMetrics: used` becomes `GPU field aggregates`; an
  unavailable adapter is reported as `fieldMetrics: fallback` and does not
  claim hardware execution.
- Seed-lock and target-family construction now submit candidate groups through
  the same aggregate adapter; the SEDLEC receipt therefore covers those paths
  as well as breadth/depth beam expansion.
- Beam-depth orchestration flattens field candidates across retained states:
  the CPU-backed receipt observed 14 aggregate batches for 3,376 breadth
  candidates and 14 for 3,443 depth candidates, versus one dispatch per state
  before this boundary. The same receipt now batches labeled frontier-state
  transitions at 14 breadth and 14 depth batches instead of 760 and 828,
  respectively. This is a dispatch-efficiency receipt, not a hardware speed
  claim.

Focused receipts pass with `node packages/search-core/test/webgpu-field-metrics.test.js`,
`node apps/field-guide/test/v2-search-receipt.test.js`, and `npm run check`.
Actual WebGPU execution remains unverified in the current in-app browser.
