# v2 resident-state cache live gate — 2026-08-12

## Live matched SEDLEC sample

Fixture: `SEDLEC-00Q_ISLAND-001`, port 5174, worker cache-buster
`20260812-residentavailability1`.

- WebGPU path: `10,180.6 ms`;
- CPU oracle: `14,024.9 ms`;
- nodes: `3,348`;
- canonical signature: matched.

The GPU path was active and faster in this sample, but browser timing remained
noisy. Instrumented totals were `980.7 ms` for resident frontier state and
`756.3 ms` for frontier topology. The cache change is therefore not presented
as an isolated wall-time win.

## Regression verification

The full `npm test` suite passed after the resident-state availability cache and
worker cache-buster changes, including all frontier, renderer, worker, product
receipt, cancellation, and runtime tests.

## Gate status

Resident-state caching remains parity-safe and cancellation-safe. GPU-first
completion remains open pending stable repeated improvement on supported
hardware; the next bounded action is to profile topology/state dispatch and
readback overlap rather than alter ordering or result semantics.
