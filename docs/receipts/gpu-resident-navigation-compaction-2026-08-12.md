# GPU resident navigation compaction receipt — 2026-08-12

## Live verification

The existing resident navigation compaction path was exercised through the v2
performance page with `SEDLEC-00Q_ISLAND-001`:

- GPU path: 3,396.8 ms, 3,348 nodes
- forced CPU oracle: 4,892.5 ms, 3,348 nodes
- canonical signature parity: true
- resident navigation: 12,456 input rows compacted to 25 selected records
- navigation input representation: `gpu-resident-compacted-records`
- aggregate navigation-plan stage: 15 calls, 163.9 ms total, 29.2 ms maximum
- cancellation/resume: checkpoint returned, resumed completion true,
  canonical signature match true, node-count match true

## Interpretation

This verifies that the realistic SEDLEC path is using GPU prefix compaction and
bounded selected-record readback while preserving the CPU oracle gate. It is
not a claim of GPU-first completion; end-to-end timing remains variable and
the remaining stages still require measurement before algorithmic promotion.
