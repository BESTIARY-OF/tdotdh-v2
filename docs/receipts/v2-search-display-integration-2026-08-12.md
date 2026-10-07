# v2 search/display integration gate — 2026-08-12

## Live search

- Fixture: `SEDLEC-00Q_ISLAND-001`
- GPU: `4,093.9 ms`
- CPU oracle: `5,520.3 ms`
- Nodes: `3,348`
- Canonical signature: matched
- CPU-over-GPU speedup: `1.348x`
- Terminal dedup: verified WebGPU, `gpuEntryCount=25`, `oracleHashCount=0`

## Live display after search

- Product URL: `http://127.0.0.1:5174/?v=20260812-rendersearchgate1`
- Field bounds: `20 × 11`
- Coverage: `135 / 135 squares`
- DOM grid slots: `220` (the accessibility and interaction surface)
- WebGPU overlay canvas: present, `data-renderer-status=rendered`
- Runtime status: `GPU smoke parity verified`

This verifies the search result remains displayable through the flatland renderer boundary after a realistic search. The DOM grid remains the semantic interaction fallback; no future projection backend is claimed.
