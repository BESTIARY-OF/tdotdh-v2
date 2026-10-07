# GPU resident-state single-submit receipt

Date: 2026-08-12
Fixture: `SEDLEC-00Q_ISLAND-001`

## Change

Resident parent gathering, child expansion, readback copies, and publication
now share one ordered command encoder. The previous host-side submission and
`onSubmittedWorkDone()` between parent gathering and expansion were removed;
the GPU command stream preserves the dependency between the ordered compute
passes. Publication remains before the explicit queue completion/readback
boundary.

## Verification

- Focused resident-state and navigator tests: passed.
- Full `npm test`: passed.
- Live matched SEDLEC benchmark after cache-busted reload:
  - GPU: `5,318.8 ms`
  - CPU oracle: `6,167.1 ms`
  - Nodes: `3,348`
  - CPU-over-GPU ratio: `1.159x`
  - Canonical signature match: `true`
  - GPU stages: all 11 production stages
  - CPU fallback stages: none
  - Canonical replay: `verified`
  - Resident state: `659.1 ms` total, `534.5 ms` expansion
- Live cancellation/resume after the change:
  - Cancellation returned a checkpoint at depth `2`, node offset `98`.
  - Resume completed at node offset `3,348`.
  - Baseline completed at node count `3,348`.
  - Resumed/baseline canonical signatures matched.
  - Resumed/baseline node counts matched.

The change preserves correctness and removes a host synchronization edge, but
this sample is not by itself a decisive performance claim. Further controlled
samples remain required before closing the GPU-first milestone.
