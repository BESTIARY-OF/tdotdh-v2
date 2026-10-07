# GPU frontier metrics buffer-reuse receipt — 2026-08-12

## Change

Commit `4feb212` adds capacity-keyed leased GPU input/output/readback buffers
to the frontier-metrics adapter. Each batch still has a distinct lease and
`mapAsync` remains the explicit result boundary, so concurrent evaluation
cannot alias buffers and CPU-oracle parity semantics are unchanged.

## Live A/B observation

On one live Chrome/WebGPU SEDLEC run after the change:

- GPU: 6,215.5 ms, 3,348 nodes
- forced CPU oracle: 8,316.9 ms, 3,348 nodes
- canonical signature parity: true
- frontier-metrics stage: 14 calls, 969.4 ms total, 273.4 ms maximum
- representative metric dispatch: 0.3 ms upload, 0 ms submit, 268.7 ms
  readback, 269.1 ms total
- cancellation/resume checks: all true

This sample is slower than prior runs and is not evidence of an end-to-end
speedup. It does confirm the optimization is correct and that readback/map
latency remains the dominant measured metric-stage cost. More repeated samples
are required before promotion or algorithm changes.
