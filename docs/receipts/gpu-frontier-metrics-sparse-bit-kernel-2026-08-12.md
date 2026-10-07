# GPU frontier-metrics sparse-bit kernel receipt

Date: 2026-08-12
Fixture: `SEDLEC-00Q_ISLAND-001`

## Change

The frontier-metrics WebGPU shader now traverses set bits in the canonical
parent, candidate, and ring masks instead of scanning every coordinate in the
64 x 64 grid for each candidate. Neighbor checks still use the existing bit
accessors, and the six-value metric vector remains unchanged. The CPU oracle
comparison remains an exact JSON parity gate.

The product worker, browser entrypoint, and matched benchmark harness were
cache-busted together so the live run loaded this shader revision.

## Verification

- Focused metrics test: passed; expected vector remained `[2, 1, 0, 2, 6, 79200]`.
- Full `npm test`: passed, including product receipt, cancellation, and worker-runtime tests.
- Matched live benchmark on the WebGPU-enabled browser:
  - GPU: `10,254.9 ms`
  - CPU oracle: `14,563.6 ms`
  - Nodes: `3,348`
  - CPU-over-GPU ratio: `1.42x`
  - Canonical signature match: `true`
  - GPU expansion backend: `webgpu`
  - GPU stages: `frontierTargetGeneration`, `navigationPlan`, `frontierMetrics`, `fieldMetrics`, `frontier`, `frontierState`, `frontierTopology`, `frontierScore`, `frontierRanker`, `frontierCompactor`, `frontierDedup`
  - CPU fallback stages: none
  - Canonical replay: `verified`
  - Frontier-metrics stage time: `1,575.8 ms`

This is a controlled single sample on the available hardware, not a general
performance claim or GPU-first completion gate. Cancellation/resume remains
covered by the existing automated product tests and still requires a separate
realistic live receipt before the overall milestone can be called complete.
