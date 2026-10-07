# GPU-resident frontier cache receipt — 2026-08-12

## Scope

The resident target-generation path was still rebuilding a CPU `Map` of every
open frontier cell by rescanning the complete field at each beam expansion.
`apps/field-guide/product/v2-legacy-search.js` now caches that frontier per
immutable search state and updates it incrementally when a candidate is
admitted: occupied candidate cells are removed and only their newly exposed
neighbors are added. Restored checkpoints and seed states populate the same
cache lazily. Target ordering, ring preference, candidate records, GPU
readback boundaries, cancellation, and CPU canonical-signature checks are
unchanged.

## Live SEDLEC verification

Fixture: `SEDLEC-00Q_ISLAND-001` through the cache-busted local WebGPU preview
at `http://127.0.0.1:5174/apps/field-guide/product/performance.html`.

Repeat paired run after the change:

- GPU elapsed: `3591.8 ms`
- CPU elapsed: `4278.9 ms`
- GPU nodes: `3348`
- CPU nodes: `3348`
- canonical-signature parity: `true`
- CPU-over-GPU speedup: `1.191x`
- GPU frontier target-generation calls: `82`
- GPU frontier target-generation time: `99.3 ms`
- GPU navigation-plan time: `204.3 ms`
- GPU frontier-state time: `343.3 ms`

The immediately preceding paired run measured `3318.6 ms` GPU and `1.295x`
CPU-over-GPU speedup. These are warm-run samples on one adapter, so they are
evidence that the optimization preserves the fast path, not a claim that the
cache alone explains the full run-to-run delta.

## Cancellation and resume gate

- cancellation: `cancelled` at `98` nodes after `2` progress events
- checkpoint: returned and schema-valid
- resumed result: `3250` nodes, cumulative offset `3348`
- baseline result: `3348` nodes
- resumed canonical signature matched baseline: `true`
- node-count match: `true`

## Verification

- `node --check apps/field-guide/product/v2-legacy-search.js` — passed
- `npm run test:gpu-resident-contract` — passed
- `node apps/field-guide/test/v2-search-cancellation.test.js` — passed
- `node apps/field-guide/test/v2-worker-runtime.test.mjs` — passed
- live paired SEDLEC benchmark — passed with exact node and canonical parity
- live cancellation/resume benchmark — passed
- v1 and port `5173` were not touched

## Next action

Run a controlled A/B measurement with the same browser/device session and
compare candidate-preparation timings before and after the cache. Keep the CPU
oracle and explicit readback boundaries until that measurement shows the host
scan is material in the realistic workload.
