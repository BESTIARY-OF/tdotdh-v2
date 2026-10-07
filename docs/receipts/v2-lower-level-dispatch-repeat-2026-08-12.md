# v2 lower-level dispatch repeat — 2026-08-12

## Live matched SEDLEC benchmark

This repeat used a fresh performance-gate page and the same
`SEDLEC-00Q_ISLAND-001` 15-piece fixture on port 5174. It preserved exact
canonical parity while exposing the terminal dispatch timing fields for the
same stages profiled in the preceding receipt.

| sample | GPU wall time | CPU wall time | nodes | canonical parity | CPU/GPU |
| --- | ---: | ---: | ---: | --- | ---: |
| dispatch repeat | 4,731.0 ms | 6,387.4 ms | 3,348 / 3,348 | true | 1.350x |

| terminal receipt | upload | submit | readback | total |
| --- | ---: | ---: | ---: | ---: |
| frontier metrics | 0.1 ms | 0 ms | 1.2 ms | 106.4 ms |
| resident frontier state | 0 ms | 0.1 ms | 20.8 ms | 20.9 ms |
| navigation plan | — | — | compact 4.3 ms; count/select scan 3.4 ms; decode 8.1 ms | — |

The repeat shows low metrics readback and a variable resident-state readback
within the same browser/device session. These are terminal-call samples, not
an end-to-end attribution: the full search performs repeated per-depth calls
and includes browser orchestration and other stages. GPU-first completion
remains open pending cancellation/resume parity and stable supported-hardware
improvement.

Next bounded action: instrument or aggregate the repeated frontier-metrics and
resident-state dispatch fields across depths, rather than optimizing from a
single terminal call.
