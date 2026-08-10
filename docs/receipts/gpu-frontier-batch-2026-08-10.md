# GPU frontier batch receipt — 2026-08-10

## Scope

The v2 worker now has a protocol-native `tdotdh.frontier-batch.v0` operation.
It accepts a cursor-selected batch of partial-field candidates, validates parent
and candidate occupancy masks, computes canonical signatures through the CPU
oracle, and returns the advanced cursor and frontier receipt.

## Verified locally

- `npm run check` passed.
- `npm test` passed.
- CPU overlap rejection and disjoint acceptance passed.
- A fake accelerator with an identical validity mask is accepted as
  `backend: test-webgpu`, `parity: verified`.
- A mismatching validity mask is rejected in the executor and the CPU result
  remains authoritative.
- The existing protocol cancellation and sequence tests remain green.
- Port 5174 returned HTTP 200; port 5173 was not listening or modified.

## Boundary

This is a real GPU-frontier contract and validation path, not proof that the
entire island search is GPU-first. Candidate generation, field metrics, hole and
connectivity checks, family logic, and final ranking remain CPU-controlled until
the next promotion gates add those operations to the same protocol path.
