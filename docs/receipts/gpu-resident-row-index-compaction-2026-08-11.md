# GPU resident row-index compaction receipt — 2026-08-11

Resident navigation now emits the selected row index together with each
compacted five-word candidate record. This removes the full selected-mask
readback from the host path while preserving stable order and CPU-oracle
comparison. Selection and prefix scan are submitted in one ordered command
buffer; only group totals and the bounded compacted result cross the boundary.

## Verification

- `node --check packages/search-core/src/webgpu-frontier-navigation-plan.js`
  passed.
- `node packages/search-core/test/webgpu-frontier-navigation-plan.test.js`
  passed with a fake-device compacted-record fixture.
- Full `npm test` is required before commit.
- Two cache-busted live SEDLEC performance-gate runs completed the same 3,348
  nodes through depth 14 with WebGPU expansion, completed navigation, and exact
  canonical-signature parity:

  | sample | GPU | CPU | CPU-over-GPU |
  | --- | ---: | ---: | ---: |
  | row-index compacted 1 | 10,145.9 ms | 11,150.8 ms | 1.099x |
  | row-index compacted 2 | 11,265.2 ms | 17,007.0 ms | 1.510x |

These samples are host/adapter dependent and are not a cross-hardware claim.
The next target is reducing the remaining per-depth compacted-result
submission/readback boundary while retaining explicit result-boundary reads.
