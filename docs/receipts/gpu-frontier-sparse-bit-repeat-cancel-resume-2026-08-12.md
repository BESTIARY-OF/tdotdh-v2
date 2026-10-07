# GPU frontier sparse-bit repeat and cancellation/resume receipt

Date: 2026-08-12
Fixture: `SEDLEC-00Q_ISLAND-001`

## Controlled repeat

The matched browser benchmark was reloaded with the cache-busted sparse-bit
kernel and run through the published WebGPU worker and forced CPU oracle:

- GPU: `5,136.5 ms`
- CPU oracle: `7,224.1 ms`
- CPU-over-GPU ratio: `1.406x`
- Nodes: `3,348`
- Canonical signature match: `true`
- GPU expansion backend: `webgpu`
- GPU stages: target generation, navigation plan, frontier metrics, field
  metrics, frontier validity, frontier state, topology, score, rank,
  compaction, and deduplication
- CPU fallback stages: none
- Canonical replay: `verified`

This repeat supports the prior single-sample result, but remains hardware- and
load-dependent evidence rather than a universal performance claim.

## Live cancellation and resume

The same benchmark harness cancelled after two progress messages:

- Cancellation result: `cancelled`
- Checkpoint returned: `true`
- Cancellation checkpoint: depth `2`, node offset `98`
- Resumed result: completed at node offset `3,348`
- Baseline result: completed at node count `3,348`
- Resumed/baseline canonical signature match: `true`
- Resumed/baseline node-count match: `true`

The CPU oracle remains hidden from the product path and is used for the
canonical replay/parity gate. The overall GPU-first milestone remains open
until additional controlled measurements establish stable improvement across
the supported hardware profile.
