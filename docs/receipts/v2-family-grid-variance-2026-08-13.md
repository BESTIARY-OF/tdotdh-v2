# v2 family-grid variance check — 2026-08-13

## Scope

Repeated the matched `SEDLEC-00Q_ISLAND-001` 15-piece fixture through the live
`apps/field-guide/product/benchmark.html?mode=family-grid` entrypoint on port
5174. Each run used the same three-family plan, weights 3/5/4, 10,044 search
nodes, and the same canonical result boundary.

## Measurements

| Backend | Run 1 | Run 2 | Mean | Result |
| --- | ---: | ---: | ---: | --- |
| WebGPU | 15,765.8 ms | 14,950.5 ms | 15,358.2 ms | canonical signature matched |
| CPU oracle | 32,171.4 ms | 26,905.8 ms | 29,538.6 ms | canonical signature matched |

The two-run mean is approximately **1.92× faster on WebGPU** for this laptop
and fixture. The GPU family batch reported three fused tasks, 13 fused score
dispatches, and 27 fused rank dispatches; capacity fallback remained zero.

## Interpretation

This is a real end-to-end family-grid improvement, not a stage-only number:
the same families, weights, node count, and canonical arrangement were
returned. The CPU control is visibly noisier across only two samples, so this
receipt does not claim a stable production benchmark or GPU-first completion.
The next performance gate is a longer controlled sample set plus fused-path
resume measurement.
