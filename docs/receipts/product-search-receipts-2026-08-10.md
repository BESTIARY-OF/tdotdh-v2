# Product search receipt benchmark — 2026-08-10

Command: `npm run bench:v2:product-search`

Fixture: the 15 source shapes from `SEDLEC-00Q_ISLAND-001`, with the published
orientation locks. The benchmark injects a deterministic all-valid prefilter
adapter; it measures receipt routing, not GPU throughput.

| Path | Elapsed | Nodes | Prefilter receipt | Batches | Candidates |
| --- | ---: | ---: | --- | ---: | ---: |
| breadth | 3471.40 ms | 3376 | `used / benchmark` | 760 | 3376 |
| depth | 3179.67 ms | 3443 | `used / benchmark` | 828 | 3443 |
| target-family | 613.13 ms | 10 | `not-used / locked-seed-branch-path` | 0 | 0 |

All three paths returned a valid placement result. The target-family receipt is
intentional: its locked-seed branch currently bypasses the candidate prefilter,
so it is not described as GPU-accelerated. This is the next integration seam.
