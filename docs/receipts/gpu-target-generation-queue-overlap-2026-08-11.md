# GPU target-generation queue overlap receipt — 2026-08-11

## Change

Resident target generation now treats queue submission order as the
synchronization boundary when `readback` is deferred. It no longer waits for
`queue.onSubmittedWorkDone()` after each resident dispatch; later resident
stages submit work to the same WebGPU queue and therefore observe the prior
dispatches in order. The parity/result-boundary path still waits before mapping
origins, validity, and records, and cancellation is still checked before
submission. Persistent snapshots remain retained until their explicit release.

This removes one host wait from each of the 82 target-generation dispatches in
the matched SEDLEC run without changing the GPU-resident handle contract or
the CPU oracle.

## Matched SEDLEC benchmark

Cache-busted browser run on `SEDLEC-00Q_ISLAND-001` (repeat sample after one
noisy warm run):

| Path | Wall time | Nodes | Depth | Canonical signature |
| --- | ---: | ---: | ---: | --- |
| WebGPU path | 3,213.5 ms | 3,348 | 14 | exact CPU parity |
| CPU oracle | 4,842.2 ms | 3,348 | 14 | reference |

The measured CPU-over-GPU ratio was 1.507x for this run. The target-generation
stage fell from 349.6 ms across 82 resident dispatches to 80.3 ms. The first
post-change sample was noisy at 3,702.2 ms wall time; the repeat above is the
receipt sample. GPU participation remained active for frontier expansion,
target generation, topology, metrics, state, scoring, ranking, compaction,
and deduplication; target pool remained an explicit CPU-control skip.

## Cancellation/resume

The cache-busted live cancellation run passed all gates:

- cancelled at node 98 with a checkpoint;
- resumed to completion;
- resumed canonical signature matched the baseline;
- resumed node count matched the baseline.

## Verification

- `node packages/search-core/test/webgpu-frontier-target-generator.test.js` passed;
- full `npm test` passed;
- live matched SEDLEC benchmark passed with exact canonical parity;
- live cancellation/resume parity passed.

## Next bounded action

Measure the remaining dominant resident metrics and state boundaries, then
reduce one boundary while preserving GPU queue ordering, explicit result
boundaries, and CPU canonical-signature parity.
