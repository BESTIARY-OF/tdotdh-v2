# GPU resident dispatch timing receipt — 2026-08-11

## Scope

Instrumented the resident frontier transition boundary to separate host upload, queue submission, and digest/map-readback time. The instrumentation is diagnostic only: it preserves the existing queue order, shader inputs, digest contract, resident parent references, and terminal CPU canonical-signature parity gate.

## Realistic SEDLEC run

Fixture: `SEDLEC-00Q_ISLAND-001` on the local WebGPU preview at `127.0.0.1:5174`.

- GPU elapsed: `3033.6 ms`
- CPU elapsed: `4035.8 ms`
- GPU nodes: `3348`
- CPU nodes: `3348`
- canonical-signature parity: `true`
- CPU-over-GPU speedup: `1.330x`
- resident transitions: `14`
- resident dispatch calls: `14`
- cumulative host upload: `2.3 ms`
- cumulative queue submit: `0.3 ms`
- cumulative digest/map readback: `125.8 ms`
- cumulative dispatch time: `129.1 ms`

## Decision

Resident dispatch is readback-bound, not upload- or submit-bound: digest/map readback accounts for approximately `97.4%` of measured dispatch time. Keep the digest readback contract for now because host-side state grouping and deduplication consume the absolute/canonical digest pair. The next optimization must establish a GPU-resident digest consumer or an equivalently exact replacement before removing this boundary.

## Gates

- `node --check packages/search-core/src/webgpu-resident-frontier-state.js` — passed
- `node --check apps/field-guide/product/v2-legacy-search.js` — passed
- `node packages/search-core/test/webgpu-resident-frontier-state.test.js` — passed
- live realistic SEDLEC benchmark — passed with exact node and canonical-signature parity
- unrelated dirty files were not staged: `apps/field-guide/product/benchmark.html`, `docs/card-agent-roster.md`
