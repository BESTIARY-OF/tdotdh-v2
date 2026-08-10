# WebGPU frontier deduplication runtime receipt — 2026-08-10

## Scope

This receipt covers the new GPU-first beam deduplication seam and the bounded
resumable product-search checkpoint in the v2 field-guide worker. It does not
claim that ticket arbitration, cursor scheduling, cancellation acknowledgement,
or final CPU canonical acceptance have moved onto the GPU.

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

The product search cursor now carries a versioned beam checkpoint after each
completed layer. Reload/cancel resume rehydrates placements, field occupancy,
remaining pieces, and scores; device-local GPU state is discarded and rebuilt
through the parity-gated adapters.

## Limits

The live receipt proves the adapter path and parity-gated runtime status. It is
not a throughput claim for the full SEDLEC search, and the end-to-end navigator
gate still requires coordinator-level GPU batch scheduling, cancellation
checkpoint receipts, and final CPU canonical replay receipts.
