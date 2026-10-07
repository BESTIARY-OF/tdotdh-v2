# GPU frontier topology summary map boundary receipt — 2026-08-12

## Change

The production resident topology path already records both label propagations and aggregate summaries in one command encoder. It now maps the summary readback directly after queue submission; the preceding queue-wide `onSubmittedWorkDone()` wait was redundant because `mapAsync()` is the explicit result boundary for that copy. Diagnostic paths and CPU decisions are unchanged.

The worker import was cache-busted as `20260812-topowait1`.

## Verification

- `node --check packages/search-core/src/webgpu-frontier-topology.js` — passed.
- `node packages/search-core/test/webgpu-frontier-topology.test.js` — passed.
- `npm test` — passed.
- Fresh browser benchmark at `http://127.0.0.1:5174/apps/field-guide/product/benchmark.html?mode=matched&v=20260812-topowait1` — passed.

## Exact live matched result

| Measure | GPU | CPU |
| --- | ---: | ---: |
| elapsed | 3,598.9 ms | 5,598.4 ms |
| nodes | 3,348 | 3,348 |

- canonical signature match: `true`
- fallback-status count in GPU receipt: `0`
- fixture: `SEDLEC-00Q_ISLAND-001`
- topology stage: `269.6 ms` total across `16` calls

The prior exact run recorded `363.1 ms` for the topology stage; this receipt records an observed reduction, not a controlled isolated attribution of all end-to-end variance.

This is a measured GPU path with CPU-oracle parity; it is not a claim that the entire GPU-first milestone is complete.
