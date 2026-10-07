# GPU frontier metrics resident-handle receipt — 2026-08-12

## Change reviewed

Durable agent commit `20cb6cc` adds `evaluateResident()` to the frontier-metrics adapter. It dispatches the six-value geometry metric output without mapping it, returns a deferred GPU-resident handle, and performs CPU canonical-signature parity only when `resolve()` is called at an explicit result boundary. Existing `evaluate()` behavior remains unchanged.

## Verification

- Focused `packages/search-core/test/webgpu-frontier-metrics.test.js` — passed.
- Full `npm test` — passed.
- The focused test verifies no map occurs before `resolve()`, exactly one map at resolve, verified CPU parity, reusable buffers, and clean resource release.

## Integration status

The adapter contract is verified but not yet wired into `v2-legacy-search.js`. Production still consumes materialized geometry rows because ranking currently reads `gpuGeometry[5]` on the host. The next integration must retain a release path for cancellation and resolve the handle before that ranking boundary; no production GPU-first claim is made from this additive API alone.
