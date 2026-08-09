# field-guide

Main-thread UI shell. It renders bounded projections of the bank and owns persistence, import/export, URL state, and search-controller lifecycle.

## Local preview

From the repository root:

```text
node apps/field-guide/serve.mjs 5174
```

Open `http://127.0.0.1:5174/`. This preview is intentionally separate from
v1 port 5173. It demonstrates the canonical flatland renderer boundary and
CPU sample search; compute-shader acceleration remains explicitly unavailable
until a real backend is implemented and parity-tested.
