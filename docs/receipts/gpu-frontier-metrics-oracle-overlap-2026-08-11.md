# GPU frontier-metrics/oracle overlap receipt — 2026-08-11

`webgpu-frontier-metrics.evaluate()` now submits all eligible metric batches
before running its CPU oracle. The oracle remains mandatory and is still
compared element-for-element with the GPU result; only the ordering of
submission and verification changed so synchronous CPU work can overlap the
device queue.

## Verification

- `node --check packages/search-core/src/webgpu-frontier-metrics.js` passed.
- `node packages/search-core/test/webgpu-frontier-metrics.test.js` passed.
- Full `npm test` passed, including product receipt, cancellation, and worker
  runtime tests.
- Two cache-busted live SEDLEC performance-gate runs completed the same 3,348
  nodes through depth 14 with `canonicalSignatureMatch: true` and completed
  navigation:

  | sample | GPU | CPU | CPU-over-GPU |
  | --- | ---: | ---: | ---: |
  | warm 1 | 7,253.1 ms | 7,894.5 ms | 1.088x |
  | warm 2 | 8,098.3 ms | 8,415.4 ms | 1.039x |

The GPU path is modestly ahead on these two samples on the current adapter,
but this is not a cross-hardware claim. The next target is the topology
batch/readback boundary, which still performs repeated label reductions per
depth.
