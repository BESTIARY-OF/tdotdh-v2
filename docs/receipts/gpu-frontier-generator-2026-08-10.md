# GPU frontier generation receipt — 2026-08-10

## Scope

The v2 product search now routes frontier candidate enumeration through a
`tdotdh.webgpu-frontier-generator.v0` adapter. The adapter packs the current
field, the locked piece cells, occupancy mask, and bounds into GPU buffers;
one invocation deterministically enumerates field-cell × direction × piece
source candidates and returns origins plus validity flags. The CPU generator
remains the ordering and parity oracle, and the adapter falls back explicitly
when WebGPU is unavailable, a device limit is insufficient, execution fails,
or GPU output disagrees with the oracle.

The product receipt exposes `frontierGeneration` separately from frontier
validation and candidate scoring, so a human can distinguish GPU generation,
GPU validation, and CPU fallback in the live search status.

## Verification

- `node --check packages/search-core/src/webgpu-frontier-generator.js`
- `node packages/search-core/test/webgpu-frontier-generator.test.js`
- full `npm run check && npm test`
- realistic `npm run bench:v2:product-search`
- manual 5174 search/cancellation smoke test with v1/5173 preserved

This slice moves candidate generation onto the accelerator boundary. Metrics,
ordered deduplication, beam policy, and the CPU oracle remain outside the GPU
until the next GPU-resident frontier compaction slice.
