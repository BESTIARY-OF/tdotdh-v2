# GPU resident row-index compaction receipt — 2026-08-11

Resident navigation now emits the selected row index together with each
compacted five-word candidate record. This removes the full selected-mask
readback from the host path while preserving stable order and CPU-oracle
comparison. Selection and prefix scan are submitted in one ordered command
buffer; only group totals and the bounded compacted result cross the boundary.

## Verification

- `node --check packages/search-core/src/webgpu-frontier-navigation-plan.js`
  passed.
- `node packages/search-core/test/webgpu-frontier-navigation-plan.test.js`
  passed with a fake-device compacted-record fixture.
- Full `npm test` passed after adding per-dispatch timing to the resident
  navigation receipt.
- Two cache-busted live SEDLEC performance-gate runs completed the same 3,348
  nodes through depth 14 with WebGPU expansion, completed navigation, and exact
  canonical-signature parity:

  | sample | GPU | CPU | CPU-over-GPU |
  | --- | ---: | ---: | ---: |
  | row-index compacted 1 | 10,145.9 ms | 11,150.8 ms | 1.099x |
  | row-index compacted 2 | 11,265.2 ms | 17,007.0 ms | 1.510x |

These samples are host/adapter dependent and are not a cross-hardware claim.

The cache-busted timing run after instrumentation completed the same 3,348
nodes through depth 14 with exact canonical-signature parity:

  | sample | GPU | CPU | CPU-over-GPU |
  | --- | ---: | ---: | ---: |
  | resident timing | 8,603.7 ms | 9,385.2 ms | 1.091x |

The final depth's resident navigation dispatch reported 3.8 ms for upload and
count, 5.0 ms for selection/scan readback, 5.2 ms for compaction/readback, and
14.6 ms for host decode. These are per-dispatch diagnostics, not a claim that
the whole search takes that long. The next target is the larger per-depth
candidate-generation, field-metrics, and frontier-state budget while retaining
explicit result-boundary reads.
