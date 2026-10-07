# GPU frontier resident-metrics lifecycle receipt — 2026-08-12

## Change

The GPU frontier-metrics adapter now exposes an explicit resident-handle
release boundary. Production search dispatches candidate geometry metrics,
keeps the output resident while field metrics, validity, state, and topology
run, resolves it at the result boundary before host ranking, and releases it
when cancellation arrives before that boundary. Deduplication now partitions
GPU-state-eligible rows from explicit CPU-oracle rows instead of abandoning an
entire mixed batch.

## Verification

- `node --check apps/field-guide/product/v2-legacy-search.js` — passed.
- `node --check apps/field-guide/product/v2-search-worker.js` — passed.
- `node --check apps/field-guide/product/benchmark.js` — passed.
- `npm test` — passed, including resident-metrics lifecycle, product receipt,
  cancellation, and worker-runtime tests.

Fresh matched SEDLEC run after cache-busting the worker and legacy-search
modules:

`http://127.0.0.1:5174/apps/field-guide/product/benchmark.html?mode=matched&v=20260812-metricsresident5`

| Measure | GPU | CPU |
| --- | ---: | ---: |
| elapsed | 4,150.7 ms | 5,921.1 ms |
| nodes | 3,348 | 3,348 |

- canonical signature match: `true`
- GPU frontier metrics/state/topology/score/ranker: `used`, WebGPU,
  parity-verified (topology uses `labels-verified`)
- remaining explicit fallback: `frontierDedup`, 15-candidate group,
  `gpu-state-unavailable`

Cancellation/resume run:

`http://127.0.0.1:5174/apps/field-guide/product/benchmark.html?mode=cancel-resume&v=20260812-metricsresident7`

- cancellation returned a checkpoint at node offset `98`.
- resumed search completed with `3,250` additional nodes and cumulative offset
  `3,348`.
- baseline completed with `3,348` nodes.
- resumed/baseline canonical signature matched: `true`.
- node-count match: `true`.

This receipt records a verified resident lifecycle and measured improvement;
it does not claim GPU-first completion while the dedup fallback remains.
