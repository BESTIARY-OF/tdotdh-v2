# v2 dispatch timing aggregate repeat — 2026-08-12

## Live matched SEDLEC benchmark

The aggregate timing instrumentation was rerun on a fresh performance-gate
page against `SEDLEC-00Q_ISLAND-001` on port 5174.

| GPU wall time | CPU wall time | nodes | canonical parity | CPU/GPU |
| ---: | ---: | ---: | --- | ---: |
| 7,254.5 ms | 11,238.1 ms | 3,348 / 3,348 | true | 1.549x |

| stage | calls | upload | submit | readback | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| frontier metrics | 14 | 11.7 ms | 0.8 ms | 67.3 ms | 1,861.4 ms |
| resident frontier state | 14 | 4.7 ms | 0.7 ms | 221.3 ms | 229.3 ms |

The repeat found the arrangement and preserved exact CPU canonical-signature
parity. Resident-state readback is material but not the dominant measured
dispatch total in this run; frontier metrics remained larger. Browser/device
variance is substantial, so this is attribution evidence rather than a fixed
throughput claim.

Next bounded action: profile the repeated frontier-metrics dispatch internals
or its result-boundary behavior before changing resident-state algorithms.
