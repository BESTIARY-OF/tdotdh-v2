# GPU resident dedup single-submit path

Date: 2026-08-12

## Change

Resident digest deduplication now records the digest-table compute pass and stable finalize/keep pass in one ordered command encoder. The previous host wait and second queue submission were removed. The GPU buffers, stable keep ordering, mapped readback boundary, and CPU oracle parity check are unchanged.

## Verification

Repository checks:

- syntax check passed
- focused deduplicator test passed
- full `npm test` passed

Live matched SEDLEC benchmark on v2 port 5174:

- GPU: 3,348 nodes, 4,565.5 ms
- CPU oracle: 3,348 nodes, 5,916.8 ms
- canonical signature: match
- measured speedup: 1.296x CPU-over-GPU
- WebGPU stage uses: 120
- compute-shader stage uses: 15
- oracle fallback statuses: zero

Live cancellation/resume:

- cancellation checkpoint: node 98, depth 2
- resumed cursor offset: 3,348
- uninterrupted baseline: 3,348 nodes
- checkpoint captured: true
- resume completed: true
- canonical signature match: true
- node count match: true
