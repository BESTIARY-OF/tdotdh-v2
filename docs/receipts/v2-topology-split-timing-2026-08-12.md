# v2 topology split timing — 2026-08-12

## Live matched SEDLEC sample

Fixture: `SEDLEC-00Q_ISLAND-001`, port 5174, topology profile cache-buster
`20260812-topoprofile3`.

- WebGPU path: `3,759.3 ms`;
- CPU oracle path: `6,249.0 ms`;
- nodes: `3,348`;
- canonical signature: matched.

The final topology result now exposes separate attribution timings:

- CPU frontier-topology oracle: `10.8 ms`;
- CPU topology label reduction: `6.5 ms`;
- WebGPU topology summary boundary: `23.0 ms`.

The GPU timing includes the terminal topology reduction and its result-boundary
readback. This is the final topology call's split, not yet an aggregate of all
per-depth topology calls; the stage-level aggregate remains separately timed by
the worker.

## Verification

- Topology syntax and focused topology tests passed.
- Product search receipt and cancellation/resume tests passed.
- Live result retained exact canonical parity and realistic GPU frontier
  participation.

## Next action

Accumulate the split timing fields across per-depth topology receipts so the
dominant topology cost can be attributed over the full search, without changing
the parity gate or readback boundary.
