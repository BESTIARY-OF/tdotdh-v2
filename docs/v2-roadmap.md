# v2 roadmap

1. Establish deterministic CPU golden fixtures and packed occupancy.
2. Replace full per-candidate metrics with incremental cheap metrics plus retained-state topology validation.
3. Add persistent weighted frontier cursors so family-depth workers do not restart the same seed.
4. Add bounded worker protocol, cancellation acknowledgement, and coordinator ordering.
5. Move the bank to IndexedDB projections and windowed rendering.
6. Add WebGPU candidate-batch adapter; compare canonical signatures against the CPU oracle before throughput claims. The adapter seam and CPU integration are present; browser parity is the remaining gate.
7. Add a renderer boundary that keeps flatland coordinates canonical while treating sphere, hypersphere, cube, hypercube, and simplex projections as explicit future targets. The capability boundary is implemented; non-flatland targets remain vocabulary-only.

Acceptance requires unchanged v1 semantics for valid arrangement capture, family-depth selection, weighted selected-family allocation, and import/export compatibility.
