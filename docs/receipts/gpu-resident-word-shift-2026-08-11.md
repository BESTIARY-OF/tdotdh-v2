# GPU resident word-shift canonicalization receipt — 2026-08-11

## Change

Resident frontier-state canonicalization previously walked every grid cell for
every piece and candidate. The shader now finds the occupied bounds by scanning
row words, then translates each piece's bitset with word/bit shifts. This keeps
the same independent `minX`/`minY` normalization semantics while removing the
cell-by-cell canonicalization loop from the GPU path.

The CPU transition oracle, canonical signatures, resident parent references,
and deferred-versus-verified readback contract are unchanged. The worker import
was cache-bumped to ensure the browser used the new shader. No v1 or staging
files were changed.

## Matched SEDLEC benchmark

Cache-busted browser run without diagnostic capture:

| Path | Wall time | Nodes | Depth | Canonical signature |
| --- | ---: | ---: | ---: | --- |
| WebGPU path | 4,827.5 ms | 3,348 | 14 | exact CPU parity |
| CPU oracle | 6,036.1 ms | 3,348 | 14 | reference |

The measured CPU-over-GPU ratio was 1.250× for this run. This is a supported
browser sample, not a universal hardware claim. GPU stage receipts reported
`webgpu:used` for frontier expansion, frontier state, topology, scoring,
ranking, compaction, and deduplication; target generation remained resident on
WebGPU and the redundant target-pool stage remained an explicit CPU-control
skip.

Selected GPU stage totals from the same run:

- resident frontier state: 606.9 ms across 14 transitions;
- field metrics: 900.2 ms across 14 evaluations;
- resident target generation: 379.1 ms across 82 batches.

The previous fresh comparison before this change measured resident frontier
state at 956.1 ms. Wall time is noisy across browser runs, so the stage-level
reduction is the primary signal for this change.

## Cancellation/resume

The cache-busted live cancellation run passed all gates:

- cancelled at node 98 with a checkpoint;
- resumed for 3,250 local nodes to cumulative offset 3,348;
- baseline completed at 3,348 nodes;
- canonical signature matched;
- node count matched.

## Verification

- resident frontier-state contract test passed;
- navigation-plan test passed;
- full `npm test` passed;
- live matched SEDLEC benchmark passed;
- live cancellation/resume parity passed.

## Next bounded action

Measure the remaining field-metrics and control-plane dispatch/readback costs on
the same fixture, then reduce one dominant boundary without changing the CPU
canonical-signature or cancellation/resume contracts.
