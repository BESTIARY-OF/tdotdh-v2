# v2 topology live profile — 2026-08-12

## Matched SEDLEC sample

Fixture: `SEDLEC-00Q_ISLAND-001`, port 5174, cache-buster
`20260812-topoprofile1`.

- WebGPU path: `8,447.1 ms`;
- CPU oracle: `8,453.7 ms`;
- nodes: `3,348`;
- canonical signature: matched.

The overall run was effectively tied in this sample. Frontier topology
instrumentation accounted for `664.4 ms` across 16 calls:

- `evaluateBatch`: `498.2 ms` across 14 calls;
- `evaluate`: `166.2 ms` in the terminal path;
- availability: `0 ms` after memoization.

These adapter timings do not yet split the CPU parity reduction from the GPU
label-summary dispatch, so they are not sufficient to attribute the cost to
one side or the other.

## Gate status and next action

Canonical parity and realistic frontier participation remain verified, but this
sample does not establish GPU improvement. Next action: add separate timers
around the CPU topology oracle and WebGPU label-summary boundary, then rerun
the same fixture without changing ordering, parity, cancellation, or readback
semantics.
