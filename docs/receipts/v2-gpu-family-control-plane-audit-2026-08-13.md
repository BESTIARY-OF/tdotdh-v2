# v2 GPU family control-plane audit — 2026-08-13

## Scope

Audited the published worker and its runtime tests for the multi-family GPU
family×weight contract. The audit covered task ownership, parallel dispatch,
GPU residency, fused stage diagnostics, explicit CPU-oracle fallback, and
product receipt propagation.

## Findings

- `v2-search-worker.js` creates one task adapter per planned family, keeps a
  deterministic task index, and coordinates layer barriers through the shared
  resident frontier state.
- Topology, score, and rank adapters batch task submissions; each reports
  fused dispatch counts and maximum task batch size.
- The family receipt records `parallel`, task counts, weight slots, overlap,
  GPU stages, and fused diagnostics. The app propagates these into the
  published search receipt and labels CPU-oracle stages separately.
- CPU paths remain explicit oracle fallbacks. The runtime does not silently
  report them as accelerated stages.

## Verification

Passed:

- `node apps/field-guide/test/v2-worker-runtime.test.mjs`
- `node apps/field-guide/test/v2-search-cancellation.test.js`
- `node apps/field-guide/test/product-bundle.test.js`
- `git diff --check`

This is a control-plane audit, not a completion claim. End-to-end GPU timing,
canonical parity, cancellation/resume, and browser-specific behavior remain
active verification gates.
