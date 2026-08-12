# v2 controlled stage sample repeat — 2026-08-12

## Live matched SEDLEC benchmark

This fresh browser run used the same `SEDLEC-00Q_ISLAND-001` 15-piece fixture,
the live v2 worker on port 5174, and the forced CPU oracle from the performance
gate. The GPU path completed all 15 accelerated stage adapters; the CPU path
was used only for the comparison run.

| sample | GPU wall time | CPU wall time | nodes | canonical parity | CPU/GPU |
| --- | ---: | ---: | ---: | --- | ---: |
| repeat | 4,770.3 ms | 7,597.2 ms | 3,348 / 3,348 | true | 1.593x |

The GPU result found an arrangement and matched the CPU canonical signature
exactly. The observed GPU stage totals were `frontierMetrics 503.3 ms`,
`fieldMetrics 440.0 ms`, `frontierState 390.5 ms`, `frontierTopology 353.8 ms`,
`frontierScore 209.7 ms`, `navigationPlan 172.0 ms`, and
`frontierDedup 106.0 ms`. All stage availability receipts reported the WebGPU
backend.

This is a controlled repeat on the current browser/device, not a cross-device
performance claim. GPU-first completion remains open until cancellation/resume,
canonical parity, and measured improvement are demonstrated together across a
realistic search gate.

Next bounded action: use a lower-level dispatch benchmark to separate browser
scheduling and readback overhead from the remaining stage totals before changing
the resident-state, topology, or field-metrics algorithms.
