# v2 fused cancel/resume live gate — 2026-08-13

## Scope

Ran the production benchmark page in cancel/resume mode against the live 5174
worker using the matched SEDLEC 15-piece fixture. The worker was cancelled
after two progress messages, then resumed from its serialized checkpoint and
compared with a fresh baseline run.

## Measurements

- Cancellation: acknowledged after 98 nodes and 2 progress messages.
- Checkpoint: returned with `tdotdh.product-search-checkpoint.v0`.
- Resumed run: 15,915.0 ms, 3,250 local resumed nodes, cumulative cursor offset
  3,348.
- Fresh baseline: 15,811.1 ms, 3,348 nodes.
- Resume overhead: approximately **0.66%** versus the fresh baseline.
- Canonical signature: exact match between resumed and baseline results.
- Checks: checkpoint present, resumed completion, canonical parity, and
  cumulative node-count match all passed.

This validates the fused worker's cancellation/checkpoint/resume boundary on a
realistic SEDLEC search. It does not yet establish long-run performance or
GPU-first completion; the CPU oracle remains the correctness authority.
