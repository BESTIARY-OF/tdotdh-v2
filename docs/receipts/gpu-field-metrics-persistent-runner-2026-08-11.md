# Persistent GPU field-metrics runner receipt — 2026-08-11

Field-metrics evaluation now reuses capacity-sized occupancy, centroid,
outside-label, output, and readback buffers across depth passes. The shader
work and explicit metric readback are unchanged; only resource lifetime and
bind-group setup move out of the per-depth hot path. CPU evaluation remains the
parity oracle whenever verification is requested.

## Verification

- `node --check packages/search-core/src/webgpu-field-metrics.js` passed.
- `node packages/search-core/test/webgpu-field-metrics.test.js` passed.
- Full `npm test` passed.
- Cache-busted live SEDLEC runs completed the same 3,348 nodes through depth 14
  with exact canonical-signature parity:

  | sample | GPU | CPU | CPU-over-GPU |
  | --- | ---: | ---: | ---: |
  | persistent field metrics 1 | 8,098.0 ms | 7,765.0 ms | 0.959x |
  | persistent field metrics 2 | 8,617.2 ms | 7,895.2 ms | 0.916x |

These end-to-end samples are noisy and do not yet prove a whole-search speedup.
The stage receipt did show field-metrics totals of 649.3 ms and 852.1 ms in the
two runs, compared with 949.0 ms in the prior instrumented run; this is a
stage-level signal, not a cross-hardware claim. The next action is to keep the
runner while measuring a larger sample set and then target resident frontier
state expansion, which remains a larger repeated boundary.
