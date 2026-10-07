# v2 frontier-metrics depth profile — 2026-08-12

## Live matched SEDLEC benchmark

The aggregate timing instrumentation was inspected per depth on a fresh live
performance-gate run against `SEDLEC-00Q_ISLAND-001` on port 5174.

| GPU wall time | CPU wall time | nodes | canonical parity | CPU/GPU |
| ---: | ---: | ---: | --- | ---: |
| 7,228.1 ms | 11,418.1 ms | 3,348 / 3,348 | true | 1.580x |

The frontier-metrics stage ran 14 verified WebGPU calls, with cumulative
dispatch timing of `1,915.2 ms` (`20.7 ms` upload, `0.9 ms` submit, `78.3 ms`
readback). The per-depth total timings were:

| depth | candidates | total | readback |
| ---: | ---: | ---: | ---: |
| 0 | 15 | 351.2 ms | 5.9 ms |
| 1 | 83 | 100.2 ms | 1.9 ms |
| 2 | 773 | 231.1 ms | 4.6 ms |
| 3 | 758 | 315.4 ms | 2.3 ms |
| 4 | 498 | 117.0 ms | 3.9 ms |
| 5 | 199 | 73.4 ms | 4.0 ms |
| 6 | 236 | 95.3 ms | 2.3 ms |
| 7 | 220 | 65.4 ms | 1.4 ms |
| 8 | 177 | 79.2 ms | 1.4 ms |
| 9 | 147 | 86.0 ms | 1.5 ms |
| 10 | 104 | 70.8 ms | 4.6 ms |
| 11 | 66 | 60.2 ms | 1.7 ms |
| 12 | 47 | 101.1 ms | 41.3 ms |
| 13 | 25 | 168.9 ms | 1.5 ms |

The profile points to depth 0 and depth 3 as the largest total-time calls; the
depth-12 readback spike is isolated and not representative of the cumulative
readback share. This is current browser/device attribution evidence, not a
general throughput claim.

Next bounded action: inspect the frontier-metrics batch sizing and dispatch
work for the high-cost early depths before attempting a code change.
