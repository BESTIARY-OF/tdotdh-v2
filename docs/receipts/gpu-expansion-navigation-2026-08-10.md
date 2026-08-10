# GPU-first expansion navigation receipt — 2026-08-10

## Scope

The product-search lifecycle now reports whether frontier expansion was
GPU-owned or used the CPU oracle. Each expansion layer carries a deterministic
stage ticket with backend and ownership labels. The coordinator still owns
cursor arbitration, cancellation observation, checkpoint persistence, and the
final canonical placement signature.

## Realistic SEDLEC fixture

`npm run bench:v2:product-search` completed against the 15-piece
`SEDLEC-00Q_ISLAND-001` source-shape fixture:

- breadth: 3,376 nodes, depth 14, placements accepted, 81 expansion batches,
  14 cancellation checkpoints, canonical replay verified;
- depth: 3,443 nodes, depth 14, placements accepted, 87 expansion batches,
  14 cancellation checkpoints, canonical replay verified;
- target-family run: 10 nodes, placement accepted, target-pool path exercised,
  canonical replay verified.

The benchmark adapters are CPU oracle implementations labelled as benchmark
backends. They prove the ticket/cursor/cancellation/parity contract and must
not be read as hardware-throughput measurements.

The frontier compactor now reuses a bounded WebGPU allocation across calls:
storage input/output buffers, uniform parameters, readback, and the bitonic
pipeline are kept alive and reset on device loss. The CPU frontier objects
still own the payload between expansion layers; the next seam is to move that
payload into the persistent GPU buffer and exchange only bounded tickets,
cursors, and parity-gated readback.

The labeled frontier-state transition now follows the same lifetime rule. Its
parent labels, candidate masks, remaining-piece masks, output labels, hashes,
uniform parameters, and readback buffers are allocated once per worker and
reused across transition batches. The CPU transition remains the canonical
parity gate; a device failure destroys the allocation and falls back without
changing the search result or checkpoint shape.

## Live product acceptance

- Preview: `http://127.0.0.1:5174/`
- The live product worker traversed the full 15-piece search, reaching depth
  12/14 while continuing across passes and capturing new arrangements.
- The product receipt surface now exposes `expansionOwnership` as either
  `gpu-owned` or `cpu-oracle-fallback`, plus the number of GPU-owned expansion
  batches and the CPU canonical replay status.

## Gate status

This closes the coordinator evidence slice of the end-to-end navigator gate.
It does not claim that every irregular control-flow decision has moved into a
shader, nor does it claim a speedup until a real WebGPU run records adapter
backend and wall-clock comparisons against the v1 CPU worker. The next seam is
to replace CPU candidate-object materialization with a persistent GPU frontier
buffer and bounded GPU compaction, while retaining exact CPU canonical replay.
