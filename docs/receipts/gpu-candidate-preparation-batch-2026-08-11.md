# GPU candidate preparation batch receipt — 2026-08-11

The resident frontier-state path now prepares each beam job with one shared
parent-label mask and one normalized piece-id schema. Candidate-specific
frontier masks and remaining-piece masks are still distinct, while the
GPU-facing candidate records preserve the existing ordering, parent references,
deterministic ticketing, cancellation checks, and CPU parity gate.

## Verification

- `node --check packages/search-core/src/webgpu-labeled-frontier-state.js`
  passed.
- `node --check apps/field-guide/product/v2-legacy-search.js` passed.
- Focused labeled-state test passed, including batch-vs-single candidate
  canonical/hash parity.
- Full `npm test` passed.
- One cache-busted live SEDLEC run completed the same 3,348 nodes through depth
  14 with exact canonical-signature parity:

  | sample | GPU | CPU | CPU-over-GPU |
  | --- | ---: | ---: | ---: |
  | batched candidate preparation | 7,561 ms | 7,931.5 ms | 1.049x |

  The resident frontier-state stage measured 529.9 ms, field metrics 667.4 ms,
  target generation 350.0 ms, and resident navigation planning 503.6 ms.
  This is a safe preparation reduction, but the single sample is not a claim
  of universal speedup; repeat measurements remain required.
