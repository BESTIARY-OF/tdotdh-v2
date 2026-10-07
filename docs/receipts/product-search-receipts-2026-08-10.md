# Product search receipt benchmark — 2026-08-10

Command: `npm run bench:v2:product-search`

Fixture: the 15 source shapes from `SEDLEC-00Q_ISLAND-001`, with the published
orientation locks. The benchmark injects a deterministic all-valid prefilter
adapter; it measures receipt routing, not GPU throughput.

| Path | Elapsed | Nodes | Prefilter receipt | Batches | Candidates |
| --- | ---: | ---: | --- | ---: | ---: |
| breadth | 3268.67 ms | 3376 | `used / benchmark` | 760 | 3376 |
| depth | 3157.09 ms | 3443 | `used / benchmark` | 828 | 3443 |
| target-family | 579.61 ms | 10 | `used / benchmark` | 45 | 1565 |

All three paths returned a valid placement result. The target-family path now
uses the same prefilter seam inside its locked-seed recursion; CPU branching and
ranking remain authoritative.
