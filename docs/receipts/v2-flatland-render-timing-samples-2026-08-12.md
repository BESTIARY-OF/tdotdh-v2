# v2 flatland render timing samples — 2026-08-12

Three fresh 5174 product reloads, with search idle, produced rendered WebGPU overlays:

| Reload | Overlay status | Isolated render time |
|---|---|---:|
| 1 | rendered | 63.5 ms |
| 2 | rendered | 56.8 ms |
| 3 | rendered | 55.2 ms |

Median: `56.8 ms`; range: `55.2–63.5 ms`.

The page remained at `GPU smoke parity verified · real search receipt pending` for each sample. These are display-submission samples only, not a search-performance claim.
