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
v2 runtime now exposes two parity-gated WebGPU seams: candidate scoring and
candidate occupancy prefiltering. They report unavailable unless the browser
actually supplies WebGPU and the GPU results match the CPU oracle. Flatland is
the only renderer implementation; future projection targets remain vocabulary
only.
