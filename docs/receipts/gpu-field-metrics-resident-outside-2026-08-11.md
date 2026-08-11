# GPU field-metrics resident outside-region receipt — 2026-08-11

## Change

The deferred field-metrics path no longer prepares an `outsideMask` with a
CPU flood fill for every candidate. It seeds boundary-empty labels and
propagates them over the candidate batch in WebGPU, then consumes the final
labels directly from the field-metrics dispatch. The CPU flood fill remains
available to the CPU oracle and explicit parity checks. Candidate construction
in the product opts into deferred outside-mask preparation.

The product receipt gate was also corrected so `parity: deferred` is reported
as GPU stage participation rather than as a CPU fallback. Deferred parity is
still not presented as proof of oracle equality; the terminal/parity boundary
continues to require `parity: verified`.

## Verification

- `npm test` passed, including field metrics, product receipt, cancellation,
  and worker-runtime tests.
- `git diff --check` and Node syntax checks passed.
- Browser smoke on the realistic SEDLEC product created a WebGPU device and
  completed a search pass with 11 GPU stages, including `fieldMetrics`, and 2
  explicit CPU/oracle stages (`frontierGeneration`, `frontierCompactor`).
- The browser smoke pass reported `GPU device ready` and completed in 452 ms;
  this is a stage/runtime receipt, not a full-search speed claim.
- Recent full-search repeats remain parity-exact but noisy: 7,632.9 ms GPU vs
  7,690.5 ms CPU, then 8,284.6 ms GPU vs 7,949.4 ms CPU. No stable throughput
  improvement is claimed.

## Remaining gate

The next performance gate is to reduce or eliminate the remaining CPU
frontier-generation and compaction work, then repeat the realistic SEDLEC
benchmark with canonical-signature parity, cancellation/resume checks, and
multiple supported-hardware samples.
