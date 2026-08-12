# Live GPU-first SEDLEC benchmark receipt — 2026-08-11

## Fixture and gate

The published matched benchmark was run through the live v2 worker at
`http://127.0.0.1:5174/apps/field-guide/product/benchmark.html` using the
`SEDLEC-00Q_ISLAND-001` 15-piece fixture.

## Result

| measure | GPU worker | CPU oracle |
| --- | ---: | ---: |
| wall time | 8,244.2 ms | 9,601.9 ms |
| nodes | 3,348 | 3,348 |
| final depth | 14 | 14 |

- Canonical signature: exact match.
- CPU/GPU speed ratio: `1.165x` in favor of GPU on this run.
- GPU stage receipts: frontier, field metrics, score, ranker, compactor,
  deduplication, topology, and labeled frontier state all reported WebGPU
  participation with verified parity; target generation reported resident
  WebGPU participation with deferred parity.

## Timing diagnosis

The measured GPU-stage calls summed to `3,667.6 ms` against `8,244.2 ms`
wall time, leaving approximately `4,576.6 ms` outside those stage timers.
Depth telemetry identified `4,388.4 ms` of candidate preparation and
`686.8 ms` of candidate materialization, while measured GPU evaluation was
`2,317.9 ms`. These figures overlap by design because the depth control-plane
timer encloses sub-stages; they are not additive. They do establish that the
remaining performance problem is primarily host/control-plane and data
marshalling overhead, not pipeline creation alone.

## Interpretation

This is a real end-to-end GPU-participation and parity result on the current
machine, not a universal performance claim. The former `111,979 ms` regression
is not reproduced. GPU-first completion remains open until the control-plane
overhead is reduced and repeated measurements on supported hardware show a
robust improvement.

## Next bounded action

Instrument candidate-preparation sub-operations separately (target-plan
construction, resident record decode, JS candidate materialization, and
readback/selection) before changing search algorithms.
