# GPU target-generation normalization cache receipt — 2026-08-12

## Change

The resident target-generator batch previously normalized the same field-cell,
target-cell, and bounds arrays once per remaining piece even when all inputs
shared those arrays. Batch-local identity caches now reuse those immutable
normalized values while continuing to normalize each piece shape and lock.
The cache is scoped to one batch, so it cannot leak mutable state across
search passes or alter candidate ordering.

Diagnostic timings were also added at the resident generator boundary for
upload, queue submission, and optional result readback. The live resident path
does not synchronously read back; its dispatch timing was approximately `0.1`
ms, confirming that the larger target-generation stage is host normalization /
layout work rather than a hidden queue wait.

## Live SEDLEC verification

Cache-busted local preview: `http://127.0.0.1:5174/apps/field-guide/product/performance.html`.

- GPU elapsed: `3598.4 ms`
- CPU elapsed: `5029.7 ms`
- GPU nodes: `3348`
- CPU nodes: `3348`
- canonical-signature parity: `true`
- CPU-over-GPU speedup: `1.398x`
- target-generation stage: `61.2 ms` across 82 resident calls
- target-generation maximum call: `4.1 ms`
- resident dispatch timing payload: one resident batch, `0.1 ms` total,
  `0` ms upload, `0` ms submit, `0` ms readback

The immediately preceding cache-busted run measured `75.9 ms` across the same
82 calls with a `7.6 ms` maximum call. Run-to-run GPU timing remains variable,
so this is evidence of reduced target-generation host work, not a broad
hardware performance guarantee.

## Cancellation and resume gate

- cancellation: `cancelled` at `98` nodes after `2` progress events
- checkpoint: returned
- resumed result: `3250` nodes, cumulative offset `3348`
- baseline result: `3348` nodes
- resumed canonical signature matched baseline: `true`
- node-count match: `true`

## Verification

- `node --check packages/search-core/src/webgpu-frontier-target-generator.js` — passed
- `npm run test:gpu-frontier-target-generator` — passed
- `node apps/field-guide/test/v2-search-receipt.test.js` — passed
- `node apps/field-guide/test/v2-search-cancellation.test.js` — passed
- live SEDLEC GPU/CPU parity run — passed
- live cancellation/resume run — passed
- v1 and port `5173` — untouched

## Next action

Run the full test suite and retain the timing fields as observability. The next
optimization candidate is the remaining per-batch layout construction; do not
remove CPU parity or explicit result-boundary reads based on this sample.
