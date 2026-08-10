# v2 roadmap

1. Establish deterministic CPU golden fixtures and packed occupancy.
2. Replace full per-candidate metrics with incremental cheap metrics plus retained-state topology validation.
3. Add persistent weighted frontier cursors so family-depth workers do not restart the same seed.
4. Add bounded worker protocol, cancellation acknowledgement, and coordinator ordering.
5. Move the bank to IndexedDB projections and windowed rendering.
6. Add parity-gated WebGPU navigation stages: candidate batches, frontier generation,
   target pools, field aggregates, geometry, state, topology, and ranking. The
   family/locked path now shares the target-pool gate instead of silently
   reverting to a CPU-only target selector.
7. Close the end-to-end GPU navigator gate: GPU-owned batch expansion and
   hash-first deduplication with deterministic ticket/cursor exchange, cancellation
   checkpoints, and canonical-signature replay by the CPU oracle.
8. Add a renderer boundary that keeps flatland coordinates canonical while
   treating sphere, hypersphere, cube, hypercube, and simplex projections as
   explicit future targets. The capability boundary is implemented;
   non-flatland targets remain vocabulary-only.

Acceptance requires unchanged v1 semantics for valid arrangement capture,
family-depth selection, weighted selected-family allocation, and import/export
compatibility. A stage may claim GPU use only with a verified CPU parity receipt;
the current runtime evidence covers scorer/prefilter dispatch, while the new
target-pool and family-branch integration still need a product-worker runtime
receipt before throughput claims.
