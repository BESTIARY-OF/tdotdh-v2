# v2 topology cumulative regression gate — 2026-08-12

## Verification

- Full `npm test` passed after cumulative topology timing instrumentation.
- The suite covered domain, search-core, topology, resident frontier state,
  browser-handoff, worker protocol/runtime, product receipt, and
  cancellation/resume tests.
- Port `5173` remained listening for v1.
- Port `5174` remained listening for the v2 preview.
- Existing unrelated edits in `apps/field-guide/product/benchmark.html` and
  `docs/card-agent-roster.md` were preserved and not staged.

## Gate status

The cumulative topology timing path is regression-safe and remains explicit
about the CPU oracle. GPU-first completion is still open pending stable
measured improvement across supported hardware; no claim is made from the
timing samples alone.
