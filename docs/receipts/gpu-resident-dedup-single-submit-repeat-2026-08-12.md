# GPU resident dedup single-submit repeat

Date: 2026-08-12
Commit under test: `6b30b3d`

The committed build was rerun against the matched `SEDLEC-00Q_ISLAND-001` benchmark on port 5174:

- GPU: 3,348 nodes, 4,024.7 ms
- CPU oracle: 3,348 nodes, 5,691.5 ms
- canonical signature: match
- measured speedup: 1.414x CPU-over-GPU
- WebGPU stage uses: 120
- compute-shader stage uses: 15
- oracle fallback statuses: zero

This repeat confirms the single-submit resident dedup path remains all-GPU and parity-gated after commit.
