# GPU topology resident batching receipt — 2026-08-11

## Change

The production (`verifyParity: false`) WebGPU frontier-topology path now keeps
occupied-label propagation, occupied-component summarization, empty-label
propagation, and hole summarization in one command encoder. It uses separate
uniform parameter buffers for the occupied and empty summaries so both modes
retain their intended values before submission. Diagnostic parity runs still
use the existing readback-separated path.

This removes the intermediate queue submissions, `onSubmittedWorkDone()` waits,
and host-visible label transfers from the resident path. The CPU topology
implementation and the readback path remain unchanged as correctness oracles.

## Matched SEDLEC benchmark

Cache-busted browser run on `SEDLEC-00Q_ISLAND-001`:

| Path | Wall time | Nodes | Depth | Canonical signature |
| --- | ---: | ---: | ---: | --- |
| WebGPU path | 3,276.6 ms | 3,348 | 14 | exact CPU parity |
| CPU oracle | 4,966.0 ms | 3,348 | 14 | reference |

The measured CPU-over-GPU ratio was 1.516x for this run. This is a supported
browser sample, not a universal hardware claim. The GPU topology stage fell to
298.4 ms across 14 batch evaluations, versus 384.4 ms in the immediately
preceding verified run. The rest of the stage receipt remained resident for
frontier expansion, target generation, metrics, state, scoring, ranking,
compaction, and deduplication; the target-pool stage remained an explicit
CPU-control skip.

## Cancellation/resume

The cache-busted live cancellation run passed all gates:

- cancelled at node 98 with a checkpoint;
- resumed to the same cumulative node offset as the baseline;
- resumed canonical signature matched the baseline;
- node count matched.

## Verification

- `node packages/search-core/test/webgpu-frontier-topology.test.js` passed;
- full `npm test` passed;
- live matched SEDLEC benchmark passed with exact canonical parity;
- live cancellation/resume parity passed.

## Next bounded action

Measure the remaining dominant resident boundaries, especially target
generation and frontier metrics, then reduce one boundary without changing the
CPU-oracle signature or the explicit result-boundary contract.
