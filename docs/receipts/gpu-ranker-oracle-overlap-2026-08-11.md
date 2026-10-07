# GPU ranker/oracle overlap receipt — 2026-08-11

The WebGPU frontier ranker previously computed every CPU-oracle sort before
submitting any GPU sort batch. The ranker now submits all storage-capable GPU
batches first, computes the mandatory CPU oracle while those submissions are
in flight, and compares the returned indices afterward. Capacity failures and
parity mismatches still use the same CPU result path.

## Verification

- `node --check packages/search-core/src/webgpu-frontier-ranker.js` passed.
- `node packages/search-core/test/webgpu-frontier-ranker.test.js` passed.
- Full `npm test` passed, including product receipt, cancellation, and worker
  runtime tests.
- Two cache-busted live SEDLEC performance-gate runs completed the same 3,348
  nodes through depth 14 with `canonicalSignatureMatch: true` and completed
  navigation:

  | sample | GPU | CPU | CPU-over-GPU |
  | --- | ---: | ---: | ---: |
  | warm 1 | 7,667.2 ms | 7,658.2 ms | 0.999x |
  | warm 2 | 7,785.2 ms | 7,709.7 ms | 0.990x |

The change removes a known CPU-before-submit dependency, but these samples do
not establish a stable GPU throughput advantage. The remaining critical path
is the repeated per-depth GPU dispatch/readback work visible in stage timing;
that is the next optimization target.
