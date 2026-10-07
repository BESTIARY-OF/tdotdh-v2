# v2 frontier-metrics redundant-copy removal — 2026-08-12

## Implementation

`dispatchGpuBatch` previously encoded and submitted an output-to-readback
copy, then the explicit result-boundary reader encoded and submitted the same
copy again. The dispatch path now submits only the compute pass; the reader
owns the single copy and `mapAsync` result boundary. This applies to both the
immediate evaluation path and the deferred resident handle.

The worker imports the change with cache-buster `20260812-sparsebits2`.

## Verification

- Focused frontier-metrics test passed.
- Syntax checks passed for the metrics module and worker.
- Full `npm test` passed, including product receipt, cancellation, and worker
  runtime tests.
- Live matched SEDLEC gate on port 5174 passed with exact parity:

| GPU wall time | CPU wall time | nodes | canonical parity | CPU/GPU |
| ---: | ---: | ---: | --- | ---: |
| 7,055.1 ms | 8,263.8 ms | 3,348 / 3,348 | true | 1.171x |

Aggregated GPU dispatch fields were `frontierMetrics: 14 calls, 2,450.2 ms
total, 67.9 ms readback` and `frontierState: 14 calls, 373.9 ms total, 363.8
ms readback`.

The live result is a parity verification, not a conclusive performance
improvement claim: browser/device variance is large and the wall-time sample
does not isolate the removed copy. GPU-first completion remains open.

Next bounded action: collect a controlled before/after pair or add a narrower
dispatch-level counter around the result-boundary copy before further changes.
