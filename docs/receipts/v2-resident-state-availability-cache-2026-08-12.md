# v2 resident-state availability cache — 2026-08-12

## Change

`createWebGpuResidentFrontierState` now memoizes its WebGPU capability probe
for the lifetime of the resident state instance. The production worker import
was cache-busted as `20260812-availabilitycache1`.

The probe cache is cleared by `reset()`, including device-loss recovery, so a
new device is revalidated. No resident buffers, frontier labels, digests,
ticket order, canonical replay data, or result-boundary readbacks were changed.

## Verification

- Resident frontier state test passed.
- Navigation coordinator test passed.
- Product cancellation/resume test passed.

## Gate status

This is a focused control-plane optimization. A fresh live matched SEDLEC
benchmark and the full suite remain the next verification step; GPU-first
completion is not claimed until the live result remains canonical-parity-safe
and measured improvement is stable.
