# GPU frontier geometry receipt — 2026-08-10

The v2 search path now has a parity-gated `tdotdh.webgpu-frontier-metrics.v0`
adapter. For each frontier batch it reduces candidate geometry in one compute
dispatch: parent contact, centroid contact, ring coverage, open-ring count,
combined bounds area, and the fixed-point beam geometry score.

The CPU implementation computes the same six values from the same occupancy
masks. The adapter only returns `status: completed` with `parity: verified` when
the complete metric matrix matches the CPU oracle byte-for-byte. Otherwise it
returns the CPU metrics with an explicit fallback/rejection reason, and the
search retains its previous CPU calculation.

The product now feeds the verified geometry score into beam ranking and exposes
`frontierMetrics` in its search receipt. Device lifetime is shared with the
other search adapters. This slice does not claim that topology acceptance,
ordered deduplication, cancellation, or canonical signature generation are GPU
resident; those remain the next state-transition boundary.

Verification:

- `npm run check`
- `npm test`
- `npm run bench:v2:product-search`
- focused CPU/fallback receipt: `node packages/search-core/test/webgpu-frontier-metrics.test.js`
