# GPU resident publication index reuse

Date: 2026-08-12

## Change

The resident frontier publication pass now reads the existing `outputStateIndices` buffer directly. The duplicate `publishOutputIndices` allocation and queue upload were removed. The resident parameter buffers and both label mirrors remain unchanged.

## Verification

Repository verification passed:

- focused resident-state and navigator tests passed
- full `npm test` passed

Live matched SEDLEC benchmark on v2 port 5174:

- GPU: 3,348 nodes, 4,510.7 ms
- CPU oracle: 3,348 nodes, 5,395.5 ms
- canonical signature: match
- measured speedup: 1.196x CPU-over-GPU
- stage receipts: WebGPU used, 120 GPU stage uses, zero oracle fallback statuses

Live cancellation/resume:

- cancellation checkpoint: node 98, depth 2
- resumed cursor: node offset 3,348, depth 14
- baseline: 3,348 nodes
- checks: checkpoint captured, resume completed, canonical signature matched, node count matched
