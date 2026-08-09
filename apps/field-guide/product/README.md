# Field-guide product port

This directory is the v2 monorepo's runnable port of the published TDOTDH field guide.
It carries the complete SEDLEC-00Q opinionated set, its recovered arrangement bank,
family records, steering state, and the real variable-field search worker. The v2
server exposes it at `/` on the preview port (5174 in development).

The product currently uses the CPU worker as its correctness oracle. The v2 runtime
bridge exposes the versioned compute and renderer contracts and reports the compute
shader backend as unavailable until canonical-signature parity is demonstrated.
This is intentionally not a claim that GPU search is already implemented.
