# Field-guide product port

This directory is the v2 monorepo's runnable port of the published TDOTDH field guide.
It carries the complete SEDLEC-00Q opinionated set, its recovered arrangement bank,
family records, steering state, and the real variable-field search worker. The v2
server exposes it at `/` on the preview port (5174 in development).

The product keeps the CPU worker as the correctness oracle while moving the hot
frontier path behind parity-gated WebGPU adapters. Candidate occupancy, frontier
generation and deterministic compaction, frontier validity/scoring, and frontier
geometry reduction (contact, centroid contact, ring coverage, open-ring count,
combined bounds area, and beam geometry score), and piece-labeled partial-field
state transition (per-piece occupancy labels, translation-normalized labels, and
remaining-piece mask) now have explicit GPU contracts. Verified labeled state
keys are used for safe beam deduplication: absolute piece labels plus remaining
pieces are required, so translated or differently assigned fields are never
conflated.
When WebGPU is available and exact parity holds, the product uses those GPU results
to rank the next beam; otherwise each slice reports an explicit CPU fallback. Full
topology acceptance now has a final parity-gated GPU occupancy reduction; its
Perimeter, centroid edge/corner coast, and bounding-box area remain
CPU-oracle-derived inside that adapter,
while component labels and empty-region flood labels now drive parity-gated
hole/connectivity reduction. Ordered deduplication,
When the adapter is available, candidate frontiers are submitted through its
batch topology contract for GPU ranking; unavailable adapters return before
doing per-candidate topology work. Cancellation/control flow, and persistence remain CPU-owned, while final
canonical signature generation is parity-checked from the GPU-derived labeled
state. The worker also exposes a protocol-native
`frontier-batch` operation with
cursor-selected candidates, canonical signatures, and resumable receipts.
