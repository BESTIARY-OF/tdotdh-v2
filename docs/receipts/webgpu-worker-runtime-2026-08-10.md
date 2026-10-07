# v2 worker WebGPU runtime receipt — 2026-08-10

## Environment

- Entry point: `http://127.0.0.1:5174/`
- Worker: `/apps/field-guide/product/v2-search-worker.js?v=20260810-v2worker4`
- Browser: headless Chrome with `--enable-unsafe-webgpu`, `--use-angle=d3d11`, and `--disable-gpu-sandbox`
- v1 port 5173: not started or modified

## Protocol probe

A versioned `start` request with two one-cell candidate arrangements completed
through the real product worker. The worker emitted `started`, `progress`,
`result`, and `completed` messages with deterministic ticket and cursor values.

The `result` receipt was:

```json
{
  "nodes": 2,
  "canonicalSignatures": ["1:0,0"],
  "prefilter": { "status": "used", "backend": "webgpu", "candidateCount": 2 }
}
```

This proves WebGPU execution inside the worker and CPU-compatible canonical
result routing. It does not claim that the full variable-field branching and
ranking topology has moved to the GPU; those remain CPU-oracle controlled.

## Product target-family regression probe

After the worker prefilter binding fix, the real 15-piece target-family path
was rerun with the published product pieces and locks. It completed with 34
nodes, four progress updates, no worker error, and this receipt:

```json
{
  "nodes": 34,
  "placements": null,
  "prefilter": { "status": "used", "backend": "webgpu", "candidateCount": 8 }
}
```

The null placement is expected for this bounded target probe; the acceptance
signal is that the worker completed normally and the live WebGPU prefilter was
used. The CPU oracle remains authoritative for branching, canonicalization,
and ranking.
