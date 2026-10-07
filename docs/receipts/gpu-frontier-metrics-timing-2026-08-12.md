# GPU frontier metrics timing receipt — 2026-08-12

## Live profile

The v2 SEDLEC performance page was run with the published
`SEDLEC-00Q_ISLAND-001` fixture after timing instrumentation was wired through
the worker receipt:

- frontier-metrics stage: 14 calls, 473.3 ms total, 88.2 ms maximum
- representative dispatch: 0.1 ms upload, 0 ms submit, 82.8 ms readback,
  84.3 ms total
- another representative dispatch: 2 ms upload, 0.1 ms submit, 62.7 ms
  readback, 65.4 ms total

## Interpretation

The dominant measured cost is result-boundary readback/map latency, not host
mask flattening or queue submission. The CPU oracle remains the parity gate.
The next bounded investigation is whether reusable metrics output/readback
buffers can reduce allocation and mapping overhead without widening the
result boundary or changing the six metric values.
