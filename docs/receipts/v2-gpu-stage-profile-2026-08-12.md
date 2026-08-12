# v2 GPU stage profile — 2026-08-12

## Fresh matched SEDLEC sample

Fixture: `SEDLEC-00Q_ISLAND-001`, live benchmark page on port 5174, fresh
cache-busted load.

| Path | Wall time | Nodes |
| --- | ---: | ---: |
| WebGPU path | 4,982.5 ms | 3,348 |
| CPU oracle | 7,387.2 ms | 3,348 |

The GPU path was active across the frontier stages and produced the same
canonical result. This sample measured the CPU path at 1.48× the GPU wall time;
it is a supported-browser sample, not a universal hardware claim.

## Instrumented stage totals

- field metrics: 493.4 ms across 15 calls;
- resident frontier state: 422.3 ms across 42 transitions;
- frontier topology: 356.2 ms across 16 calls;
- frontier score: 209.0 ms across 28 calls;
- navigation-plan selection: 174.5 ms across 15 calls;
- frontier evaluation: 160.8 ms across 14 calls;
- resident frontier deduplication: 108.6 ms across 15 calls;
- target generation: 94.5 ms across 83 calls;
- prefilter: 90.0 ms across 14 calls;
- ranking: 83.3 ms across 27 calls.

The stage sums are overlapping instrumentation boundaries, not a decomposition
of wall time. They identify field-metrics, frontier-state transitions, topology,
and plan-selection boundaries as the next bounded optimization targets.

## Gate status and next action

This verifies realistic GPU frontier participation and CPU result parity again;
it does not close the GPU-first gate because cancellation/resume and measured
improvement must remain verified across the next optimization. Next action:
reduce one of the dominant resident boundaries while preserving deterministic
ticket order, canonical signatures, and explicit result-boundary readback.
