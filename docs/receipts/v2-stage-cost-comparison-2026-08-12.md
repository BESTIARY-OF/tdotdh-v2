# v2 stage-cost comparison — 2026-08-12

## Live matched SEDLEC sample

Fixture: `SEDLEC-00Q_ISLAND-001`, port 5174, cache-buster
`20260812-costcompare1`.

- WebGPU path: `6,033.5 ms`;
- CPU oracle: `9,124.9 ms`;
- nodes: `3,348`;
- canonical signature: matched.

Current worker stage totals:

- field metrics: `443.7 ms` across 15 calls;
- resident frontier state: `503.3 ms` across 42 method calls;
- frontier topology: `502.6 ms` across 16 calls.

The topology split receipt reported `31.6 ms` GPU summary, `18.4 ms` CPU
oracle, and `17.2 ms` CPU reduction across 15 topology calls. Resident-state
dispatch instrumentation reported `19.0 ms` in its final receipt boundary,
while the worker adapter stage includes the surrounding 42 method calls.

These stage totals are overlapping instrumentation boundaries and vary with
browser scheduling; they are not a wall-time decomposition. In this sample the
three dominant stage totals were close enough that no safe single-stage rewrite
is justified.

## Gate status and next action

Realistic GPU frontier participation, canonical parity, and unchanged search
semantics remain verified. GPU-first completion remains open pending stable
measured improvement across supported hardware. Next action: retain this as a
baseline and compare another matched sample before selecting a resident-state,
topology, or field-metrics optimization.
