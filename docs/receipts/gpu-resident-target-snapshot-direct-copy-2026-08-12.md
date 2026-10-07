# GPU-resident target snapshot direct-copy receipt — 2026-08-12

## Change

The persistent target-generator resident path now copies the compute output buffer directly into each immutable resident snapshot and, at an explicit result boundary, directly into its readback buffer. The intermediate `residentRecords` GPU buffer and its extra copy were removed. This preserves queue ordering, snapshot ownership, resident handles, and CPU parity while reducing one device-to-device copy and one persistent allocation per runner.

The focused test fixture was updated for the reduced working-buffer count. The worker import was cache-busted as `20260812-targetcopy1`.

## Verification

- `node --check packages/search-core/src/webgpu-frontier-target-generator.js` — passed.
- `node packages/search-core/test/webgpu-frontier-target-generator.test.js` — passed.
- `npm test` — passed.
- Fresh browser benchmark at `http://127.0.0.1:5174/apps/field-guide/product/benchmark.html?mode=matched&v=20260812-targetcopy2` — passed.

## Exact live matched result

| Measure | GPU | CPU |
| --- | ---: | ---: |
| elapsed | 4,136.6 ms | 5,961.8 ms |
| nodes | 3,348 | 3,348 |

- canonical signature match: `true`
- fallback-status count in GPU receipt: `0`
- WebGPU-backed status records: `151`
- fixture: `SEDLEC-00Q_ISLAND-001`

## Exact live cancellation/resume result

- cancellation: `type=cancelled`, `nodes=98`, `depth=2`, `nodeOffset=98`
- resume: `type=result`, `nodes=3,250`, `nodeOffset=3,348`
- uninterrupted baseline: `3,348` nodes
- `cancelledWithCheckpoint`: `true`
- `resumedCompleted`: `true`
- `canonicalSignatureMatch`: `true`
- `nodeCountMatch`: `true`

This is a measured GPU path with CPU-oracle parity; it is not a claim that the entire GPU-first milestone is complete.
