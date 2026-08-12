# v2 frontier-metrics copy-removal repeat — 2026-08-12

## Controlled live comparison

The post-change worker was rerun against the same
`SEDLEC-00Q_ISLAND-001` fixture on port 5174 after removing the redundant
pre-boundary output copy.

| sample | GPU wall time | CPU wall time | nodes | canonical parity | CPU/GPU |
| --- | ---: | ---: | ---: | --- | ---: |
| pre-change aggregate profile | 7,228.1 ms | 11,418.1 ms | 3,348 / 3,348 | true | 1.580x |
| first post-change run | 7,055.1 ms | 8,263.8 ms | 3,348 / 3,348 | true | 1.171x |
| post-change repeat | 5,506.1 ms | 10,419.4 ms | 3,348 / 3,348 | true | 1.892x |

Post-change aggregate fields in the repeat were:

| stage | calls | upload | submit | readback | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| frontier metrics | 14 | 10.9 ms | 0.8 ms | 43.9 ms | 1,669.1 ms |
| resident frontier state | 14 | 4.8 ms | 0.9 ms | 275.4 ms | 282.5 ms |

All three samples found the arrangement and retained exact canonical parity.
The large spread across wall times and CPU baselines means this is a healthy
controlled repeat, not proof that the copy removal alone caused a fixed speedup.
The optimization remains justified by eliminating duplicate work at the
result-boundary ownership level; further attribution needs repeated paired
samples or a lower-level timestamp query.

Next bounded action: keep the change and profile another repeated GPU-only
stage sample, or compare an equivalent pre-change checkout if a strict A/B is
required.
