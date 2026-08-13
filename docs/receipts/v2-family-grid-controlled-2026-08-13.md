# v2 controlled family-grid benchmark — 2026-08-13

## Scope

Matched live-browser run of the same `SEDLEC-00Q_ISLAND-001` opinionated 15-piece fixture through the v2 family×weight grid. The grid contained three family tasks and twelve weight slots. GPU and CPU runs used the same worker request shape and the same canonical-signature gate.

## Result

| backend | wall time | nodes | task time | overlap factor | GPU stages | canonical signature |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | 20,882.0 ms | 10,044 | 60,890.7 ms | 2.984 | 12 | exact match |
| CPU oracle | 42,268.2 ms | 10,044 | 123,911.8 ms | 2.977 | 0 | exact match |

The GPU wall-time speedup over the forced CPU oracle was **2.025×**. Both runs found an arrangement and produced the identical canonical signature. The GPU run reported `familyBatch.status=used`, `familyBatch.parallel=true`, task count 3, completed task count 3, and task-scoped GPU-resident execution. Its active stages included prefilter, frontier, target generation, metrics, field metrics, frontier state, topology, ranker, score, compactor, deduplication, and navigation planning.

## Interpretation

This is evidence that the supported browser path is now using concurrent GPU family work for this realistic fixture. It is not a completion claim: the result is one controlled sample, and Firefox-specific repeatability plus broader cancellation/resume and cross-browser measurement remain part of the active verification gate.

## Heartbeat rerun

The benchmark pages were rerun during the 2026-08-13 08:17 heartbeat. The fresh matched pair measured **11,613.6 ms GPU** versus **19,941.1 ms forced CPU**, or **1.718× GPU wall-time speedup**, with the same 10,044 nodes and the same canonical signature. The GPU run reported three completed parallel tasks, 12 GPU stages, fused GPU-resident frontier execution, and an overlap factor of 2.970; the CPU run reported three completed tasks, zero GPU stages, and an overlap factor of 2.980.

## Verification source

Live benchmark page:
`/apps/field-guide/product/benchmark.html?mode=family-grid&backend=gpu&run=fusedscore1`
and the matched forced-oracle page:
`/apps/field-guide/product/benchmark.html?mode=family-grid&backend=cpu&run=fusedscorecpu1`.
