# v2 field-metrics availability cache — 2026-08-12

## Change

`createWebGpuFieldMetrics` now memoizes its capability probe for the lifetime
of the adapter instance. The worker invokes field-metrics evaluation once per
frontier depth, so repeating the same adapter/limit probe at every depth added
control-plane work without changing the result. The cache-busted worker import
is `20260812-availabilitycache1`.

The cache does not cache device resources or search results. Device-loss
handling still resets the persistent runner and device cache, while the CPU
oracle and parity gate remain unchanged.

## Verification

- Focused field-metrics, frontier-metrics, and resident-frontier-state tests passed.
- Full `npm test` passed, including product search receipt, cancellation/resume,
  worker runtime, and renderer-boundary tests.
- Fresh live matched SEDLEC sample: GPU `6,473.2 ms`, CPU oracle `8,133.0 ms`,
  and `3,348` nodes. The sample remained GPU-active and parity-preserving but
  was noisier than the prior run; no performance improvement claim is made from
  this single sample.
- Instrumented live totals for this sample included field metrics `728.0 ms`,
  resident frontier state `665.8 ms`, and topology `497.8 ms`.

## Gate status

The change is committed as a bounded control-plane optimization. GPU-first
completion remains open until repeated matched runs demonstrate stable measured
improvement while preserving canonical parity and cancellation/resume behavior.
