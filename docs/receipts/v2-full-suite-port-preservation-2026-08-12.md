# v2 full-suite and port-preservation receipt — 2026-08-12

## Verification

- `npm test` passed with exit code 0.
- Covered domain invariants, GPU frontier adapters and resident paths, renderer boundary/capability tests, worker protocol/coordinator tests, product bundle checks, v2 search receipt, cancellation, and runtime worker tests.
- `127.0.0.1:5173` listening: yes; v1 service was not modified.
- `127.0.0.1:5174` listening: yes; v2 preview remains available.
- Working tree still contains only the unrelated pre-existing changes in `apps/field-guide/product/benchmark.html` and `docs/card-agent-roster.md`.
