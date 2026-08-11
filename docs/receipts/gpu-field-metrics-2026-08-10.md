# GPU field metrics receipt — 2026-08-10

The v2 search worker now exposes `tdotdh.webgpu-field-metrics.v1`.

- Input: one occupied mask and one centroid mask per surviving branch.
- GPU aggregate: area, perimeter, integer bounds, coordinate sums, centroid
  sums, centroid edge/corner coast flags, exterior-masked inlet-cell/inlet-edge
  counts, and exact hole counts.
- Parity gate: the CPU oracle computes the same 16 integer values and rejects
  any divergent WebGPU result before the branch uses it.
- CPU-owned remainder: radius variance, quality weights, centroid family text/
  hash naming, persistence, and cancellation. Hole detection is now part of the
  parity-gated integer aggregate, so the search does not repeat the host flood
  fill for each surviving GPU candidate.
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
- Frontier-origin generation now follows the same beam-wide boundary: all
  retained states and remaining pieces are submitted through `generateBatch`,
  split only when the adapter's 16,384-candidate contract limit requires it.
  The focused product receipt verifies the beam batch path and unchanged
  SEDLEC placements/metrics against the per-state CPU path.
- A target-aware generator contract now narrows that work to target-contact ×
  piece-source pairs. It computes occupancy, bounds, and position-lock validity
  on the GPU and returns target-keyed candidates; the CPU oracle remains the
  exact parity gate. This removes the old all-field-direction enumeration from
  the preferred breadth/depth route. The SEDLEC CPU-oracle receipt observed
  81 batches / 1,170,369 candidates for breadth and 87 batches / 1,243,035
  candidates for depth, while preserving 3,376 / 3,443 search nodes and
  successful placements. The CPU harness is not a GPU timing claim.
- Deterministic beam ranking is now a multi-pass bitonic GPU contract over
  padded storage rows rather than a single 128-row workgroup. This removes the
  former JavaScript-sort capacity cliff for large family buckets; parity with
  the CPU ordering oracle remains mandatory, and device storage limits still
  trigger an explicit CPU fallback.
- Beam target-pool construction is now a batched occupancy-neighborhood
  contract: GPU masks classify open cells adjacent to the field and open cells
  adjacent to the centroid. The CPU retains only the historical insertion
  order while consuming those parity-verified masks. The benchmark receipt
  records this separately as `frontierTargetPool`; it is a navigation contract,
  not a hardware timing claim.

Focused receipts pass with `node packages/search-core/test/webgpu-field-metrics.test.js`,
`node apps/field-guide/test/v2-search-receipt.test.js`, and `npm run check`.
Actual WebGPU execution remains unverified in the current in-app browser.
