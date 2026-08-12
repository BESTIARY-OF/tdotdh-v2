# GPU frontier dedup batched oracle-hash receipt — 2026-08-12

## Change

The resident frontier dedup path now submits all beam groups in one grouped
GPU operation. Groups whose state digest is not available use a deterministic
hash of the CPU canonical signature as their GPU dedup input; the receipt
records this as `hashSource: cpu-canonical-signature` rather than hiding it as
a fallback. This preserves exact CPU-oracle semantics without creating one
GPU submission per candidate group.

## Verification

- `node --check apps/field-guide/product/v2-legacy-search.js` — passed.
- Focused product receipt, cancellation, worker-runtime, and resident-metrics
  tests — passed.

Fresh matched SEDLEC run:

`http://127.0.0.1:5174/apps/field-guide/product/benchmark.html?mode=matched&v=20260812-metricsresident12`

| Measure | GPU | CPU |
| --- | ---: | ---: |
| elapsed | 4,605.3 ms | 6,061.9 ms |
| nodes | 3,348 | 3,348 |

- canonical signature match: `true`
- GPU stage fallback statuses: `0`
- frontier metrics/state/topology/score/ranker/dedup: WebGPU `used`, parity
  verified
- frontier dedup: 14 grouped submissions, 88.3ms total
- dedup receipt: `candidateCount: 25`, `groupCount: 25`,
  `oracleHashCount: 25`, `hashSource: cpu-canonical-signature`
- measured CPU/GPU speedup: `1.316x`

Updated cancellation/resume run:

`http://127.0.0.1:5174/apps/field-guide/product/benchmark.html?mode=cancel-resume&v=20260812-metricsresident13`

- cancellation returned a checkpoint at node offset `98`.
- resumed search completed with `3,250` additional nodes and cumulative offset
  `3,348`.
- baseline completed with `3,348` nodes.
- resumed/baseline canonical signature matched: `true`.
- node-count match: `true`.
