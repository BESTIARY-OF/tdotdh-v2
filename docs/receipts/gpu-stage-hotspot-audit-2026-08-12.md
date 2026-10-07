# GPU stage hotspot audit — 2026-08-12

## Observed profile

The exact cache-busted SEDLEC matched run after the topology summary map-boundary change measured these GPU stage totals:

| Stage | Calls | Total | Maximum |
| --- | ---: | ---: | ---: |
| `frontierMetrics` | 14 | 499.1 ms | 109.9 ms |
| `frontierState` | 42 | 300.0 ms | 51.0 ms |
| `frontierTopology` | 16 | 269.6 ms | 62.6 ms |
| `fieldMetrics` | 15 | 194.1 ms | 25.7 ms |
| `frontierScore` | 28 | 181.8 ms | 17.8 ms |
| `navigationPlan` | 15 | 153.3 ms | 18.1 ms |

The benchmark itself remained GPU-owned: 3,348 GPU nodes and 3,348 CPU nodes, canonical signature match `true`, and zero fallback statuses. The frontier-metrics adapter currently returns materialized per-depth metric rows to the host; its output is therefore the next resident-buffer boundary to prototype. The other inspected candidates already encode their dependent compute passes together or contain an explicit host decision/readback boundary.

## Action

A bounded side task is prototyping a resident frontier-metrics output handle with CPU parity retained at explicit result boundaries. No production claim is made until that path is independently tested and measured.
