# GPU frontier batch-layout allocation receipt — 2026-08-12

## Scope

Reduced host-side allocation in the resident WebGPU target-generation path. The
batch layout now preallocates typed coordinate buffers instead of accumulating
temporary JavaScript arrays, and accepts batch-local identity caches for repeated
target, piece, and field-cell arrays. The persistent target runner owns the
cache objects; shader inputs, item ordering, and readback boundaries are
unchanged.

## Verification

- `node --check packages/search-core/src/webgpu-frontier-batch-layout.js`
- `node --check packages/search-core/src/webgpu-frontier-target-generator.js`
- `npm run test:gpu-frontier-batch-layout`
- `npm run test:gpu-frontier-target-generator`
- `npm test`
- live Chrome/WebGPU SEDLEC fixture: 3,348 nodes, GPU 3,095.4 ms, CPU oracle
  4,845.2 ms, canonical signature match true
- live target-generation stage: 83 calls, 61.5 ms total, 14.4 ms maximum
- live cancellation/resume: checkpoint returned, resumed run completed, node
  count matched baseline, and canonical signature matched

## Interpretation

This is a measured host-layout reduction, not GPU-first completion. The live
run confirms the realistic SEDLEC path still participates end to end and keeps
CPU canonical parity, but the remaining runtime is distributed across topology,
frontier state, metrics, scoring, ranking, and navigation stages. The next
bounded action is to profile repeated frontier-state expansion payloads and
reduce only verified redundant host materialization without widening readback.
