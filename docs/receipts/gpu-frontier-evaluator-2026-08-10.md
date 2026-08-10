# GPU frontier evaluator receipt — 2026-08-10

## Scope

The v2 product search now has a single frontier-evaluator boundary. A
candidate batch is packed into GPU-resident parent masks, candidate masks, and
fixed-point score terms. A compute dispatch evaluates occupancy validity and
the deterministic ranking key together. The CPU compacts accepted indices in
their original ticket order and remains the oracle: any validity or score
mismatch rejects the accelerated result and uses the oracle result.

The evaluator is injected into both protocol-native product searches and the
legacy compatibility path remains available. WebGPU unavailability is an
explicit fallback, not a fabricated success.

## Verification

- `npm run check` passed, including the new evaluator source and test.
- `npm test` passed, including CPU evaluator parity, product evaluator receipt,
  worker protocol, and renderer tests.
- `npm run bench:v2:product-search` passed on the SEDLEC-00Q source-shape
  fixture: breadth 7.48s / 3,376 nodes, depth 7.43s / 3,443 nodes, target
  family 1.53s / 10 nodes. These are CPU-oracle benchmark timings and are not
  a GPU speedup claim.
- The live 5174 preview advanced through real search depths with no new worker
  errors after the evaluator integration.

## Remaining boundary

Candidate geometry and field metrics are still assembled on the CPU. The next
GPU-first slice is to move those feature-generation kernels and deterministic
beam compaction into persistent device buffers, then compare the complete
frontier signature against the CPU oracle before accepting it.
