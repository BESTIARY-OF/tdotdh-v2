# Resident frontier-state batch receipt — 2026-08-11

The resident frontier-state transition batch capacity is now 1,024 rather
than 512. The realistic SEDLEC beam reaches 773 candidates at its largest
layer, so this removes a second GPU submission and digest-readback boundary
for that layer while preserving the same resident parent references and final
CPU canonical replay.

## Verification

- `node --check packages/search-core/src/webgpu-resident-frontier-state.js`
  passed.
- `node packages/search-core/test/webgpu-resident-frontier-state.test.js`
  passed.
- Full `npm test` passed.
- Two cache-busted live SEDLEC runs completed the same 3,348 nodes through depth
  14 with exact canonical-signature parity:

  | sample | GPU | CPU | CPU-over-GPU |
  | --- | ---: | ---: | ---: |
  | 1,024-state batch 1 | 8,091.6 ms | 7,598.3 ms | 0.939x |
  | 1,024-state batch 2 | 8,095.0 ms | 8,074.7 ms | 0.997x |

The frontier-state stage measured 624.1 ms and 809.4 ms in those runs; the
prior 512-state instrumented sample measured 784.1 ms. End-to-end timing is
adapter/host noisy and does not yet prove a whole-search speedup. The next
action is to retain the larger batch while auditing the remaining per-depth
resident digest/readback and CPU materialization boundaries.
