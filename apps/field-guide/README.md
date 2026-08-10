# field-guide

Main-thread UI shell. It renders bounded projections of the bank and owns persistence, import/export, URL state, and search-controller lifecycle.

## Local preview

From the repository root:

```text
node apps/field-guide/serve.mjs 5174
```

Open `http://127.0.0.1:5174/`. This preview is intentionally separate from
v1 port 5173. It demonstrates the canonical flatland renderer boundary and
uses the real CPU field-guide worker as its correctness oracle. The
v2 runtime exposes parity-gated WebGPU seams for candidate occupancy, frontier
generation/compaction, frontier validity/scoring, and frontier geometry
reduction. They report unavailable unless the browser actually supplies WebGPU
and the GPU results match the CPU oracle. The verified geometry result feeds beam
ranking; topology acceptance and canonical deduplication remain explicit CPU
oracle boundaries. Flatland is the only renderer implementation; future
projection targets remain vocabulary only.
