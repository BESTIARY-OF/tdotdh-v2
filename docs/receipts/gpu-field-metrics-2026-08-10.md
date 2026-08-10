# GPU field metrics receipt — 2026-08-10

The v2 search worker now exposes `tdotdh.webgpu-field-metrics.v0`.

- Input: one occupied mask and one centroid mask per surviving branch.
- GPU aggregate: area, perimeter, integer bounds, coordinate sums, centroid
  sums, and centroid edge/corner coast flags.
- Parity gate: the CPU oracle computes the same 13 integer values and rejects
  any divergent WebGPU result before the branch uses it.
- CPU-owned remainder: radius variance, quality weights, centroid family text/
  hash naming, hole flood semantics, persistence, and cancellation.
- Product receipt: `fieldMetrics: used` becomes `GPU field aggregates`; an
  unavailable adapter is reported as `fieldMetrics: fallback` and does not
  claim hardware execution.

Focused receipts pass with `node packages/search-core/test/webgpu-field-metrics.test.js`,
`node apps/field-guide/test/v2-search-receipt.test.js`, and `npm run check`.
Actual WebGPU execution remains unverified in the current in-app browser.
