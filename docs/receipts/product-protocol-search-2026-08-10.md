# Product protocol search receipt — 2026-08-10

## Scope

The normal `apps/field-guide` search button now starts the versioned worker
protocol with `operation: product-search`. The worker adapts the existing
field-guide search into protocol progress/result/completed/cancelled events,
while retaining the legacy message route as a compatibility fallback.

The product search remains CPU-oracle authoritative. Its GPU occupancy,
frontier, beam-layer batching, and checkpoint adapters are parity-gated;
unavailable WebGPU falls back explicitly.
Cancellation is sent through the protocol and the search loop checks the
cooperative cancellation predicate before continuing branches.

## Verification

- `npm run check` passed.
- `npm test` passed.
- `npm run bench:v2:product-search` passed against the SEDLEC-00Q source-shape
  fixture: breadth 9.53s / 3,376 nodes, depth 5.83s / 3,443 nodes, and target
  family 1.24s / 10 nodes. These are CPU-oracle benchmark timings; they do not
  claim a GPU speedup.
- Port 5174 served the cache-busted build and the live search advanced through
  multiple depths, completed a pass, and continued to the next pass.
- The live pause action produced `Search cancelled safely` from the protocol.
- Port 5173 was not modified and was not listening during the check.

## Boundary

This is a product-path integration gate, not the final GPU-first engine. The
remaining work is to move beam compaction, family quota selection, and ticket
arbitration into GPU-resident buffers while preserving canonical CPU-oracle
parity, deterministic cursor resume, cancellation, and renderer semantics.
