# v2 GPU navigation runtime receipt — 2026-08-10

## Environment

- Entry point: `http://127.0.0.1:5174/`
- Browser surface: shared Codex in-app Chromium tab
- v1 port 5173: not accessed or modified

## Observed

- `navigator.gpu`: present in the page target.
- Candidate scorer dispatch: completed with CPU parity.
- Occupancy prefilter dispatch: completed with CPU parity.
- Frontier target-pool dispatch: completed with `backend: webgpu` and
  `parity: verified`.
- Target-pool smoke input: one occupied cell and one centroid cell at `(0, 0)`;
  GPU and CPU both returned the four cardinal frontier cells and the four
  cardinal centroid-ring cells.
- Runtime label after refresh: `V2 product · GPU navigation parity verified ·
  CPU oracle fallback ready`.

## Boundary

This proves a live GPU navigation slice beyond scorer/prefilter: target-cell
classification is executing in the product page and is accepted only after CPU
oracle parity. It does not yet prove that the entire variable-field navigator
has moved its branching, deduplication, ticket/cursor exchange, cancellation,
and final canonical acceptance onto the GPU. Those remain the end-to-end gate.

## Forensic note

The first live target-pool probe correctly failed parity because the WGSL helper
accepted a runtime storage array as a function argument and returned an all-zero
mask on this implementation. Replacing that helper with direct storage-buffer
access restored exact parity. The failed result was not promoted or presented
as accelerated behavior.
