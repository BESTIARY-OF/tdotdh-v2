# Resident state readback overlap receipt — 2026-08-11

Resident frontier-state dispatch no longer waits on the entire queue before
mapping result buffers. The digest and optional label readbacks are started
concurrently; `mapAsync()` remains the completion boundary. Parent references,
resident slots, cancellation checks, and terminal CPU parity are unchanged.

## Verification

- `node --check packages/search-core/src/webgpu-resident-frontier-state.js`
  passed.
- `node packages/search-core/test/webgpu-resident-frontier-state.test.js`
  passed.
- Full `npm test` passed.
- Two cache-busted live SEDLEC runs completed the same 3,348 nodes through depth
  14 with exact canonical-signature parity:

  | sample | GPU | CPU | CPU-over-GPU |
  | --- | ---: | ---: | ---: |
  | concurrent readback 1 | 7,425.0 ms | 8,415.8 ms | 1.133x |
  | concurrent readback 2 | 7,599.1 ms | 7,912.4 ms | 1.041x |

The frontier-state stage measured 549.9 ms and 614.8 ms. These are host and
adapter-dependent measurements, but they confirm the realistic path remains
GPU-owned, parity-gated, and materially below the historical 111,979 ms
regression. Further optimization should target the remaining per-depth
candidate materialization and topology/metrics boundaries.
