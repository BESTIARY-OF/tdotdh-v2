# GPU frontier sparse-bit hotspot repeat receipt

Date: 2026-08-12
Fixture: `SEDLEC-00Q_ISLAND-001`

## Controlled live run

The cache-busted matched benchmark completed through the live WebGPU worker
and forced CPU oracle:

- GPU: `4,813.7 ms`
- CPU oracle: `7,622.2 ms`
- CPU-over-GPU ratio: `1.583x`
- Nodes: `3,348`
- Canonical signature match: `true`
- GPU expansion backend: `webgpu`
- GPU stages: all 11 production stages, including frontier metrics, resident
  state, topology, scoring, ranking, compaction, and deduplication
- CPU fallback stages: none
- Canonical replay: `verified`

## Stage timings

- Frontier metrics: `678.1 ms` across 14 calls
- Resident frontier-state: `601.2 ms` total; `495.7 ms` in `expand`
- Frontier topology: `392.0 ms`
- Field metrics: `265.1 ms`
- Navigation plan: `196.5 ms`
- Frontier score: `196.3 ms`
- Frontier ranker: `111.8 ms`
- Prefilter: `111.9 ms`
- Frontier deduplication: `83.1 ms`
- Resident target generation: `79.7 ms`

This identifies frontier metrics and resident state expansion as the next
optimization targets. The sample is controlled evidence on the current
hardware, not a universal performance claim; parity and cancellation/resume
gates remain mandatory.
