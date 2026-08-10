# Field-guide product port

This directory is the v2 monorepo's runnable port of the published TDOTDH field guide.
It carries the complete SEDLEC-00Q opinionated set, its recovered arrangement bank,
family records, steering state, and the real variable-field search worker. The v2
server exposes it at `/` on the preview port (5174 in development).

The product currently uses the CPU worker as its correctness oracle. The v2 runtime
bridge exposes versioned compute and renderer contracts, a real WebGPU candidate
scoring dispatch, and a real WebGPU candidate occupancy prefilter. Both GPU slices
are parity-gated and fall back explicitly. The product worker uses the occupancy
prefilter on candidate batches when WebGPU is available, while branching and
ranking remain CPU-controlled until canonical arrangement parity is demonstrated
for the full island search topology. The worker now also exposes a protocol-native
`frontier-batch` operation: cursor-selected partial-field candidates are packed as
frontier masks, validated by the CPU oracle and optionally WebGPU, and returned with
canonical signatures plus the resumable cursor. This is the first GPU-frontier
vertical slice; it does not yet move full candidate generation or topology ranking
onto the GPU.
