# GPU resident parameter-buffer reuse regression

Date: 2026-08-12

## Scope

I tested binding the existing 32-byte main-pass parameter buffer to the gather and publication passes, removing their two dedicated 16-byte parameter buffers and two queue uploads. The resident labels, parent mirrors, state indices, and readback paths were unchanged.

## Result

Focused tests and the full repository suite passed, but the live matched SEDLEC benchmark showed hidden fallback activity:

- GPU result: 3,262 nodes, 3,894.1 ms
- CPU oracle: 3,348 nodes, 6,464.2 ms
- top-level canonical signature: matched
- internal stage receipts: three `frontierState` transitions reported `oracle-parity-mismatch` and fell back to the CPU oracle
- first reported mismatch: `nextLabels:62`, resident parent `3227`

The apparent 1.66x timing was therefore not an all-GPU result and is not admissible for the GPU-first gate.

## Decision

Keep the dedicated gather/publication parameter buffers and their writes. Future resource-sharing experiments must pass both canonical output parity and a zero-oracle-fallback stage audit on a realistic live SEDLEC run.
