# GPU-resident frontier cache A/B receipt — 2026-08-12

## Scope

This is a controlled comparison of the resident frontier cache committed in
`dfafc3f` against its immediate parent `ab74801`. Both runs used the live
15-piece SEDLEC fixture and the same local Intel WebGPU adapter. The parent was
served on port `5175`; the cached version was served on port `5174`. The CPU
implementation remained the correctness oracle in both runs.

## Measurements

| path | GPU ms | CPU ms | GPU nodes | CPU nodes | CPU/GPU |
| --- | ---: | ---: | ---: | ---: | ---: |
| parent control | 3360.6 | 4622.0 | 3348 | 3348 | 1.375x |
| cached repeat | 3325.2 | 4055.0 | 3348 | 3348 | 1.219x |

Both runs produced an arrangement and exact canonical-signature parity.

The per-depth candidate-preparation sums were:

| path | preparation | target-pool decode | target generation | navigation dispatch | result decode |
| --- | ---: | ---: | ---: | ---: | ---: |
| parent control | 768.4 ms | 58.5 ms | 406.2 ms | 177.3 ms | 42.3 ms |
| cached repeat | 762.8 ms | 2.4 ms | 430.4 ms | 194.7 ms | 44.0 ms |

The cache removes approximately `56.1 ms` of the repeated CPU frontier-map
scan from the measured target-pool boundary. The end-to-end GPU result is only
`35.4 ms` faster in this pair, and dispatch variance is visible in the other
stages. This is therefore a verified host-work reduction, not yet a claim
that the cache alone improves total search time.

## Gates

- both runs: `3348` GPU and CPU nodes
- both runs: canonical-signature parity `true`
- cached run: GPU-first stages remained active
- v1 and port `5173`: untouched
- no browser tab retained after measurement

## Next action

Keep the cache. Repeat the A/B under multiple same-session samples and isolate
resident navigation dispatch/readback variance before making another algorithm
change. Do not remove explicit CPU parity or result-boundary readback based on
this measurement alone.
