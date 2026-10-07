# GPU resident output-index reuse repeat

Date: 2026-08-12
Commit under test: `c496e35`

## Live repeat

The committed v2 build was rerun against the matched `SEDLEC-00Q_ISLAND-001` benchmark on port 5174:

- GPU: 3,348 nodes, 4,883.6 ms
- CPU oracle: 3,348 nodes, 5,859.3 ms
- canonical signature: match
- measured speedup: 1.20x CPU-over-GPU
- WebGPU stage uses: 120
- compute-shader stage uses: 15
- oracle fallback statuses: zero

The result confirms the output-index reuse change remains parity-gated and all-GPU on a second live run. No implementation changes were made in this repeat.
