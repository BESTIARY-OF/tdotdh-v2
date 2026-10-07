# GPU resident dead-mirror optimization regression

Date: 2026-08-12

## Scope

I tested removing the `residentNext` and `residentCanonical` buffers and their shader writes from the resident frontier state path. The buffers appeared unused by gather, publication, or host readback, so this was a bounded allocation/hotspot experiment only.

## Result

The focused unit tests passed, but the live matched SEDLEC benchmark failed the acceptance gate at a late resident transition:

- GPU: 2,869 nodes, 5,451.1 ms
- CPU oracle: 3,348 nodes, 5,223.5 ms
- canonical signature: mismatch
- first reported mismatch: `nextLabels:62`, resident parent `2861`
- stage status: WebGPU available and used; no capability fallback

Because the live result lost nodes and canonical parity, I reverted the optimization. The post-revert live check restored the acceptance path:

- GPU: 3,348 nodes, 4,609.5 ms
- CPU oracle: 3,348 nodes, 6,854.3 ms
- canonical signature: match
- measured speedup: 1.487x CPU-over-GPU

## Decision

Keep both resident mirror buffers and their current binding layout until a replacement can prove live canonical parity and cancellation/resume correctness. The failed experiment is not eligible for integration.
