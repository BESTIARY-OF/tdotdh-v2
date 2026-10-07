# v2 topology cumulative repeat — 2026-08-12

## Live matched SEDLEC sample

Fixture: `SEDLEC-00Q_ISLAND-001`, port 5174, worker cache-buster
`20260812-topoprofile5`.

- WebGPU path: `4,599.1 ms`;
- CPU oracle: `6,191.0 ms`;
- nodes: `3,348`;
- canonical signature: matched.

Cumulative topology attribution across 15 calls:

- CPU topology-oracle timing: `10.6 ms`;
- CPU label-reduction timing: `18.3 ms`;
- WebGPU summary timing: `24.1 ms`.

The prior cumulative sample reported `31.5 ms` for the GPU summary boundary;
this repeat reported `24.1 ms`. The adapter-level topology stage totaled
`366.7 ms` across 16 calls, confirming that the split fields are attribution
samples rather than a direct wall-time decomposition.

## Gate status

GPU participation, canonical parity, and the unchanged search semantics remain
verified. No algorithmic change is justified by this variance. Next action:
complete the full regression suite and retain the split timings for future
resident-state comparisons.
