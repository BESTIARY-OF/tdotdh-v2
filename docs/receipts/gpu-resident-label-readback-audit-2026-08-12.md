# GPU resident label-readback audit

Date: 2026-08-12

The resident-state timing hotspot was audited before attempting another
readback optimization. The production beam path already passes
`readLabels: verifyParity` into the resident-state dispatch:

- nonterminal transitions with `verifyParity: false` do not copy or map full
  `nextLabels`/`canonicalLabels`;
- terminal/parity-gated transitions retain full label readback for the CPU
  canonical-signature gate;
- digest readback remains available for resident state admission and is
  controlled separately by `readDigests`/the resident digest consumer.

Therefore a further label-readback change would be a no-op and was not made.
The remaining measured resident-state hotspot is GPU expansion/publication
work itself (`534.5 ms` in the single-submit sample), not an overlooked full
label copy. The audit preserves the existing parity and persistence contract.
