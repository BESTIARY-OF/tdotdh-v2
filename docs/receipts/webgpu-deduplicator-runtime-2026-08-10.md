# WebGPU frontier deduplication runtime receipt — 2026-08-10

## Scope

This receipt covers the new GPU-first beam deduplication seam in the v2
field-guide worker. It does not claim that ticket advancement, cursor
persistence, cancellation acknowledgement, or final CPU canonical acceptance
have moved onto the GPU.

## Live acceptance

- Preview: `http://127.0.0.1:5174/`
- Surface: shared Codex in-app Chromium tab, reloaded after the adapter change
- Runtime label after reload: `V2 product · GPU navigation parity verified · CPU oracle fallback ready`
- Backend dataset after reload: `webgpu`
- The runtime smoke now dispatches scorer, occupancy prefilter, target-pool
  classification, and frontier deduplication, then compares every result to
  its CPU oracle before exposing the verified label.

## Safety behavior

The dedup kernel is hash-first and intentionally bounded to the beam-sized
batch. The CPU oracle compares exact canonical signatures. A hash collision,
shader failure, unavailable adapter, or parity mismatch returns the CPU keep
mask and leaves exact CPU admission in control.

## Limits

The live receipt proves the adapter path and parity-gated runtime status. It is
not a throughput claim for the full SEDLEC search, and the end-to-end navigator
gate still requires GPU-owned ticket/cursor exchange, cancellation checkpoints,
and CPU canonical replay receipts.
