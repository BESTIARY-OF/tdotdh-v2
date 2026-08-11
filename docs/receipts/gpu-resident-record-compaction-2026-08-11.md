# GPU resident-record compaction receipt — 2026-08-11

Resident candidate navigation now performs a stable two-pass compaction on the
GPU after selection: an exclusive prefix scan computes per-record positions and
group totals, then a compaction pass emits only selected five-word records in
stable row order. The CPU side reads back the selected count and compacted
records rather than the full resident record buffer. The CPU oracle remains the
parity gate for selected rows and decoded candidate records.

## Verification

- `node --check packages/search-core/src/webgpu-frontier-navigation-plan.js`
  passed.
- `node packages/search-core/test/webgpu-frontier-navigation-plan.test.js`
  passed.
- Full `npm test` passed, including worker runtime, cancellation, product
  receipt, and renderer-boundary tests.
- Two cache-busted live SEDLEC performance-gate runs completed the same 3,348
  nodes through depth 14 with WebGPU expansion, completed navigation, and exact
  canonical-signature parity:

  | sample | GPU | CPU | CPU-over-GPU |
  | --- | ---: | ---: | ---: |
  | cache-busted 1 | 7,318.5 ms | 7,685.6 ms | 1.050x |
  | cache-busted 2 | 8,000.9 ms | 9,156.5 ms | 1.144x |

The current adapter is modestly ahead in these samples; this is not a
cross-hardware claim. The next target is reducing the remaining per-depth
navigation dispatch/readback boundary rather than changing the search result
semantics.
