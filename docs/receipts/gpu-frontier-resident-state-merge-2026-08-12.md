# GPU frontier resident-state merge receipt — 2026-08-12

## Scope

Deferred frontier geometry resolution was writing the entry snapshot captured before later frontier-state stages ran. That erased `gpuState` before ranking and grouped deduplication, forcing CPU canonical-signature hashing even though the state transition had produced resident digest handles.

The resolver now merges geometry metrics into the live entry at result-boundary time. Resident state, topology, score, and other later-stage fields therefore survive the deferred geometry write-back.

## Verification

- Focused tests passed:
  - `node apps/field-guide/test/v2-search-receipt.test.js`
  - `node apps/field-guide/test/v2-search-cancellation.test.js`
  - `node apps/field-guide/test/v2-worker-runtime.test.mjs`
- Live URL: `http://127.0.0.1:5174/apps/field-guide/product/benchmark.html?mode=matched&v=20260812-residentmergefix1`
- Fixture: `SEDLEC-00Q_ISLAND-001`
- GPU: `4,106.2 ms`
- CPU oracle: `6,153.1 ms`
- Nodes: `3,348` on both paths
- Canonical signature: matched
- CPU-over-GPU speedup: `1.498x`
- Frontier state: resident digests at depths 0–12; terminal depth uses full labels and digests
- Grouped dedup: resident WebGPU path at depths 0–12, `gpuEntryCount == candidateCount`, `oracleHashCount == 0`, verified parity

The terminal layer intentionally reads back full labels and digests for the existing canonical-signature boundary. Cancellation/resume coverage remains protected by the focused cancellation test.
