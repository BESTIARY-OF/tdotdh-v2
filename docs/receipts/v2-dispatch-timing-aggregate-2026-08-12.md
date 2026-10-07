# v2 dispatch timing aggregate — 2026-08-12

## Implementation

The product search now accumulates dispatch timing fields across repeated
frontier-metrics and resident-frontier-state calls. Each final stage receipt
retains its per-call timing and adds `dispatchTimingTotals` with call count,
upload, submit, readback, and total milliseconds. The worker import was
cache-busted to `20260812-dispatchtotals1` so the live performance gate loads
the new search code.

## Verification

The full `npm test` suite passed, including product receipt, cancellation, and
worker-runtime tests. A fresh live matched run on port 5174 used the same
`SEDLEC-00Q_ISLAND-001` 15-piece fixture:

| GPU wall time | CPU wall time | nodes | canonical parity | CPU/GPU |
| ---: | ---: | ---: | --- | ---: |
| 7,151.0 ms | 8,424.3 ms | 3,348 / 3,348 | true | 1.178x |

Aggregated dispatch fields from the GPU receipt:

| stage | calls | upload | submit | readback | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| frontier metrics | 14 | 11.1 ms | 0.9 ms | 46.4 ms | 2,496.6 ms |
| resident frontier state | 14 | 3.8 ms | 0.6 ms | 448.7 ms | 455.1 ms |

The live result found the arrangement and matched the CPU canonical signature
exactly. These totals are attribution evidence for the current browser/device,
not a general throughput claim; the search still includes host orchestration,
other stages, and browser scheduling variance.

Next bounded action: use the new aggregate fields to compare one more live
repeat, then target the repeated resident-state result-boundary cost if it
remains dominant.
