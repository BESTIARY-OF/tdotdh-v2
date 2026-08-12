# GPU frontier-metrics result-boundary receipt — 2026-08-11

## Change

The frontier-metrics readback path now submits the compute pass and immediately
awaits `mapAsync` on the result buffer. `mapAsync` is the explicit visibility
boundary for the copied six-integer metric rows; the preceding queue-wide
`onSubmittedWorkDone()` wait was redundant and added a host round trip to every
metric batch. Custom shader layouts remain unchanged.

Two larger experiments were measured and rejected rather than retained:

- workgroup reduction with atomics increased the metric stage to 400.0 ms;
- bounded per-candidate scans increased it to 529.3 ms.

The production code therefore retains the simple shader, which is faster on the
current Intel WebGPU device, and records those results as measurement evidence
for the next optimization choice.

## Matched SEDLEC benchmark

Cache-busted browser run on `SEDLEC-00Q_ISLAND-001`:

| Path | Wall time | Nodes | Depth | Canonical signature |
| --- | ---: | ---: | ---: | --- |
| WebGPU path | 3,739.3 ms | 3,348 | 14 | exact CPU parity |
| CPU oracle | 4,872.5 ms | 3,348 | 14 | reference |

The measured CPU-over-GPU ratio was 1.303x for this sample. Stage timing is
noisy on this laptop; frontier metrics measured 406.3 ms in the receipt run.
The primary acceptance signal is unchanged: all 3,348 nodes and the canonical
signature match the CPU oracle, with GPU stages active for target generation,
topology, metrics, field metrics, state, scoring, ranking, compaction, and
deduplication.

## Cancellation/resume

The final cache-busted live cancellation run passed all gates:

- cancellation returned a checkpoint;
- resume completed;
- resumed canonical signature matched the baseline;
- resumed node count matched the baseline.

## Verification

- frontier-metrics focused test passed;
- full `npm test` passed;
- live matched SEDLEC benchmark passed with exact canonical parity;
- live cancellation/resume parity passed.

## Next bounded action

Inspect resident frontier-state and navigation-plan allocations. The next
optimization must reduce their control-plane cost without changing their
explicit readback boundaries or the CPU canonical-signature gate.
