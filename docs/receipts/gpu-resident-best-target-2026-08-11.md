# GPU resident best-target selection receipt — 2026-08-11

## Change

Resident frontier navigation previously rescanned all 1,024 target slots for
every resident record during `selectResident`. The shader now runs one
`chooseResidentTarget` compute pass per plan, writes the deterministic
lowest-count/lowest-ordinal target to a GPU buffer, and lets record selection
read that shared result. The CPU oracle and decoded-record parity checks remain
unchanged.

The worker and legacy-search imports were cache-bumped so the live browser used
the new navigation shader. No v1 or staging files were changed.

## Matched SEDLEC benchmark

Cache-busted browser run without diagnostic capture:

| Path | Wall time | Nodes | Depth | Canonical signature |
| --- | ---: | ---: | ---: | --- |
| WebGPU path | 4,431.2 ms | 3,348 | 14 | exact CPU parity |
| CPU oracle | 4,615.0 ms | 3,348 | 14 | reference |

The measured CPU-over-GPU ratio was 1.041× for this run. This is a supported
browser sample, not a universal hardware claim. GPU expansion was reported as
owned and verified across all 14 depth batches, with no CPU fallback expansion
stage.

Relevant aggregated stage timings from the same run:

- resident target generation: 369.0 ms across 82 batches
- resident navigation plan: 182.6 ms across 14 selection calls
- resident candidate-record compaction: not included in the product-stage
  summary because it is part of target-record generation; the worker still
  reported it as a GPU stage

A separate diagnostic-capture run is intentionally excluded from the timing
comparison: its verification/readback instrumentation raised total GPU wall
time to 23,988.5 ms while still preserving exact parity.

## Cancellation/resume

The cache-busted live cancellation run passed all gates:

- cancelled at depth 2, node offset 98, with a checkpoint;
- resumed for 3,250 local nodes to cumulative offset 3,348;
- baseline completed at 3,348 nodes;
- canonical signature matched;
- node count matched.

## Verification

- focused resident navigation test passed;
- syntax check passed;
- full `npm test` passed, including product receipt, cancellation, worker
  runtime, frontier, protocol, and renderer-boundary tests.

## Next bounded action

Measure the remaining target-record generation and GPU frontier-state costs on
the same fixture, then reduce one dominant dispatch/readback boundary while
keeping canonical ordering and the cancellation/resume checkpoint contract.
