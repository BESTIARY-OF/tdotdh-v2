# Field-guide product port

This directory is the v2 monorepo's runnable port of the published TDOTDH field guide.
It carries the complete SEDLEC-00Q opinionated set, its recovered arrangement bank,
family records, steering state, and the real variable-field search worker. The v2
server exposes it at `/` on the preview port (5174 in development).

The product currently uses the CPU worker as its correctness oracle. The v2 runtime
bridge exposes versioned compute and renderer contracts, a real WebGPU candidate
scoring dispatch, and a real WebGPU candidate occupancy prefilter. Both GPU slices
are parity-gated and fall back explicitly; the full island search topology remains
CPU-oracle controlled until canonical arrangement parity is demonstrated.
