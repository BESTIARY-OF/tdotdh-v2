# v2 topology/state boundary audit — 2026-08-12

## Finding

The WebGPU topology adapter already memoizes its capability probe. Its measured
cost is therefore not repeated availability detection; it includes the
required CPU topology reduction used for parity plus GPU label-summary work.
That CPU reduction remains an intentional correctness oracle and was not
removed or hidden behind an optimistic GPU result.

The resident frontier state likewise keeps explicit result-boundary readback
when parity is requested. Combining or deferring those reads would change the
verification contract, so no speculative readback rewrite was made in this
turn.

## Verification

- WebGPU topology tests passed.
- Resident frontier-state tests passed.
- Frontier navigator tests passed.
- Product search receipt test passed.
- Product cancellation/resume test passed.

## Next action

Profile the topology GPU label-summary dispatch against the CPU parity reduction
as separate timings. Any optimization must preserve the same labels, metrics,
canonical signatures, cancellation checkpoints, and explicit result boundary.
