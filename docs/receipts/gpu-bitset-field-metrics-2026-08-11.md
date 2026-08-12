# GPU bitset field-metrics receipt — 2026-08-11

## Change

The default 64x64 SEDLEC field-metrics path previously represented outside
space as one label per cell and ran `width + height` full-grid propagation
passes. The production path now represents outside space as a u32 bitset and
propagates one word per invocation with the same four-neighbor fixed-point
iterations. The original cell-label path remains available for irregular grids
or custom shader sources.

The metric shader reads the bitset representation without changing the emitted
16 integer aggregates. CPU outside-mask derivation remains the parity oracle
when verification is requested. Worker and product entrypoints were
cache-bumped so the live preview consumes the new shader.

## Matched SEDLEC benchmark

Cache-busted browser run without diagnostic capture:

| Path | Wall time | Nodes | Depth | Canonical signature |
| --- | ---: | ---: | ---: | --- |
| WebGPU path | 3,498.8 ms | 3,348 | 14 | exact CPU parity |
| CPU oracle | 4,801.6 ms | 3,348 | 14 | reference |

The measured CPU-over-GPU ratio was 1.372x for this run. This is a supported
browser sample, not a universal hardware claim. GPU stage receipts remained
active for frontier expansion, field metrics, frontier state, topology,
scoring, ranking, compaction, and deduplication; the redundant target-pool
stage remained an explicit CPU-control skip.

Selected GPU stage totals from the same run:

- field metrics: 229.3 ms across 14 evaluations;
- resident frontier state: 301.2 ms across 14 transitions;
- resident target generation: reported by the live worker as a WebGPU-resident
  stage.

For comparison, the immediately preceding verified run measured field metrics
at 900.2 ms and resident frontier state at 606.9 ms. Browser wall time is
noisy, so those stage-level reductions are the primary signal.

## Integration correction

The first live bitset attempt was rejected because an invalid WGSL helper shape
produced non-finite field-derived scores. The helper was replaced with a direct
global-buffer accessor, the worker was cache-bumped again, and the final run
above passed the full parity gate.

## Cancellation/resume

The cache-busted live cancellation run passed all gates:

- cancelled at node 98 with a checkpoint;
- resumed for 3,250 local nodes to cumulative offset 3,348;
- baseline completed at 3,348 nodes;
- canonical signature matched;
- node count matched.

## Verification

- field-metrics tests passed;
- full `npm test` passed after the implementation;
- live matched SEDLEC benchmark passed;
- live cancellation/resume parity passed.

## Next bounded action

Measure the remaining GPU control-plane and readback costs on the same fixture,
then reduce one dominant boundary while preserving the same contracts.
