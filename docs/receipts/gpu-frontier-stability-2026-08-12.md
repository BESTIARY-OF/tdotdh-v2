# GPU frontier stability receipt — 2026-08-12

## Verification

Two fresh matched runs against `SEDLEC-00Q_ISLAND-001` on the live v2 preview (`127.0.0.1:5174`) produced identical node counts and canonical signatures:

| Run | GPU | CPU oracle | Speedup | Nodes | Canonical parity | Resident dedup depths | Oracle hash fallback |
|---|---:|---:|---:|---:|---|---:|---:|
| 1 | 4,407.5 ms | 5,942.5 ms | 1.348x | 3,348 | true | 13 | 0 |
| 2 | 3,883.5 ms | 6,203.8 ms | 1.597x | 3,348 | true | 13 | 0 |

The timing spread is expected for a browser/device workload, but both samples preserve the same result semantics and resident-dedup path. This is a stability sample, not a claim of a fixed benchmark guarantee.
