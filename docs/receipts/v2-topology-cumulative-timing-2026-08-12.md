# v2 cumulative topology timing — 2026-08-12

## Live matched SEDLEC sample

Fixture: `SEDLEC-00Q_ISLAND-001`, port 5174, worker cache-buster
`20260812-topoprofile4`.

- WebGPU path: `4,094.3 ms`;
- CPU oracle: `6,037.9 ms`;
- nodes: `3,348`;
- canonical signature: matched.

The final topology receipt now carries cumulative timing totals across 15
topology calls:

- CPU topology-oracle timing: `11.2 ms`;
- CPU label-reduction timing: `10.2 ms`;
- WebGPU summary timing: `31.5 ms`.

The overall worker stage remains separately timed; these fields attribute the
topology adapter's reported boundaries and are not treated as a wall-time
decomposition.

## Verification

- Product search receipt test passed.
- Product cancellation/resume test passed.
- WebGPU topology test passed.
- Live search retained GPU participation and exact canonical parity.

## Next action

Use the cumulative timing fields to compare topology cost against resident state
and field metrics across repeated runs. Do not change topology ordering or
parity behavior until a stable dominant boundary is identified.
