# GPU beam-yield batching receipt — 2026-08-11

## Scope

The realistic SEDLEC benchmark exposed a host-side scheduling cost in the
beam-plan phase. The search loop was yielding to the event loop once for every
beam state. This receipt covers the narrow scheduling change only; candidate
generation, ticket order, checkpoint contents, scoring, ranking, and result
semantics are unchanged.

The loop now yields once per 16 beam states while continuing to check
cancellation on every state. This preserves responsiveness without paying a
zero-delay timer turn for each state.

## Current-code matched SEDLEC measurement

Measured through the cache-busted browser worker (`gpufirst87`, benchmark
asset `matched100`):

| Path | Wall time | Nodes | Depth | Canonical signature |
| --- | ---: | ---: | ---: | --- |
| WebGPU path | 4,614.0 ms | 3,348 | 14 | exact CPU parity |
| CPU oracle | 5,095.7 ms | 3,348 | 14 | reference |

This run measured a 1.104× CPU-over-GPU ratio. It is a single supported-browser
measurement, not a universal performance claim.

The current preparation-timing sums were:

- beam-plan build: 5.2 ms
- target-pool dispatch/decode: 0.2 ms / 83.2 ms
- target generation dispatch: 415.4 ms
- navigation input build/dispatch/decode: 0.4 ms / 590.0 ms / 54.9 ms
- candidate admission: 78.5 ms

The earlier 3,111.4 ms beam-plan figure was reduced to 5.2 ms by this change.
The remaining measured control-plane work is now concentrated in navigation
dispatch and target generation; it is the next optimization target.

## Live cancellation/resume verification

The cache-busted browser run cancelled with a resumable checkpoint at depth 2,
node offset 98. Resume completed at cumulative offset 3,348. The focused
checks all passed:

- `cancelledWithCheckpoint`: true
- `resumedCompleted`: true
- `canonicalSignatureMatch`: true
- `nodeCountMatch`: true

The full monorepo test suite also passed, including product search receipt,
cancellation, worker runtime, frontier, protocol, and renderer-boundary tests.

## Boundaries

- v1 source and staging were not modified.
- Port 5173 was preserved; v2 remains isolated on port 5174.
- `benchmark.html` retains its pre-existing cache-buster and is intentionally
  not part of this change.
- GPU-first completion is not claimed. End-to-end realistic-search parity is
  verified, but broader device coverage and a stable measured improvement over
  the CPU oracle remain open.

## Next bounded action

Instrument and reduce the remaining navigation-dispatch and target-generation
overhead without changing canonical ordering. Re-run the matched SEDLEC
benchmark and cancellation/resume parity gates before considering another
optimization.
