# GPU-resident navigation merged-submit receipt — 2026-08-12

## Change

The production resident-navigation scheduler now records and submits the
count, target selection, candidate selection, and prefix scan passes in one
GPU command buffer when diagnostic target-count capture is disabled. The
diagnostic path remains separate so its explicit target-count readback is
unchanged. The selected-group totals are still read back at the exact result
boundary needed to compute compacted output offsets; no parity gate or
cancellation checkpoint was removed.

## Live SEDLEC verification

Cache-busted module: `webgpu-frontier-navigation-plan.js?v=20260812-resident-merged-submit1`.

- GPU elapsed: `3006.6 ms`
- CPU elapsed: `5411.2 ms`
- GPU nodes: `3348`
- CPU nodes: `3348`
- canonical-signature parity: `true`
- CPU-over-GPU speedup: `1.800x`
- resident navigation: `136.1 ms` across 14 selection calls
- resident frontier state: `327.6 ms` across 14 expansion calls

Prior same-session cached samples measured resident navigation at
`183.4–213.5 ms` and frontier state at `355.5–413.4 ms`. The comparison is
directional evidence only; this laptop’s WebGPU timings are variable.

## Cancellation and resume gate

- cancellation: `cancelled` at `98` nodes after `2` progress events
- checkpoint: returned
- resumed result: `3250` nodes, cumulative offset `3348`
- baseline result: `3348` nodes
- resumed canonical signature matched baseline: `true`
- node-count match: `true`

## Verification

- `node --check packages/search-core/src/webgpu-frontier-navigation-plan.js` — passed
- `npm run test:gpu-frontier-navigation-plan` — passed
- `npm run test:gpu-resident-contract` — passed
- `node apps/field-guide/test/v2-search-receipt.test.js` — passed
- `node apps/field-guide/test/v2-search-cancellation.test.js` — passed
- live SEDLEC GPU/CPU parity run — passed
- live cancellation/resume run — passed
- v1 and port `5173` — untouched

## Next action

Repeat the merged-submit benchmark under the same session and inspect whether
the remaining resident frontier-state readback is now the dominant measured
GPU control-plane cost. Keep the CPU oracle and explicit result-boundary
readbacks until a replacement is exact and independently verified.
