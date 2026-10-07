# GPU frontier metrics buffer-reuse repeated samples — 2026-08-12

## Controlled live samples

After reloading the same v2 performance page before each run and waiting for
the benchmark control to become ready:

| Sample | GPU ms | CPU oracle ms | Nodes | Metrics total ms | Metrics max ms | Parity |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 4,715.7 | 5,590.1 | 3,348 | 755.0 | 256.2 | true |
| 2 | 4,545.6 | 6,195.3 | 3,348 | 710.4 | 160.2 | true |

Both v2 `5174` and preserved v1 `5173` returned HTTP 200 after the runs.

## Interpretation

These controlled repeats preserve the GPU-over-CPU result for this fixture,
but they are not a definitive speedup benchmark: GPU scheduling and browser
load remain variable. The buffer-reuse change is retained for correctness and
its plausible allocation benefit; further optimization should target the
remaining metric readback/map latency with repeated measurements.
