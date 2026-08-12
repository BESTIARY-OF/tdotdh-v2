# GPU cancellation/resume parity receipt — 2026-08-11

The live SEDLEC worker gate found and fixed a resumability defect. A
checkpoint previously preserved the beam but not the seeded-random state at
the interrupted depth, so a resumed breadth search could choose a different
valid arrangement. Checkpoints now carry the RNG state; cancellation restores
the state from the beginning of an interrupted depth, while completed-depth
checkpoints retain the post-depth state.

## Verification

- `node --check apps/field-guide/product/v2-legacy-search.js` passed.
- `node --check apps/field-guide/product/benchmark.js` passed.
- `v2-search-receipt.test.js` now asserts that checkpoints carry a safe random
  state; focused receipt and cancellation tests passed.
- Full `npm test` passed.
- Live browser diagnostic on the realistic SEDLEC fixture:
  - cancellation after 2 progress events at depth 2 / node offset 98;
  - cancellation emitted a non-empty resumable checkpoint;
  - resumed run completed 3,250 local nodes with cumulative cursor offset 3,348;
  - fresh GPU baseline completed 3,348 nodes;
  - resumed and fresh canonical signatures matched exactly.

The first live run before this fix intentionally failed the parity gate (the
resumed signature and cumulative work differed); that failure is retained here
as the reason for the checkpoint-state change, not counted as a pass.
