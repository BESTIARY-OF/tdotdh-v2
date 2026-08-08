# TDOTDH v2 monorepo workline

This is a separate development line for the next field-guide generation. It does not replace or modify the live v1 staging worktree on port 5173.

## First slice

- `packages/domain`: packed occupancy and immutable shape primitives.
- `packages/search-core`: deterministic weighted work-ticket scheduling.
- `packages/field-metrics`: versioned validation and geometry contract.
- `packages/search-worker`: worker protocol boundary; CPU first, WebGPU adapter later.
- `packages/persistence`: IndexedDB bank/progress boundary.
- `packages/interchange`: import/export schemas and migrations.
- `packages/browser-handoff`: URL and BroadcastChannel observation boundary.
- `apps/field-guide`: UI shell that consumes bounded projections.
- `apps/solver-worker`: separately bundled worker entrypoint.

The v2 rule is semantic compatibility first: CPU and accelerator implementations must consume the same ticket and produce the same canonical arrangement signatures before throughput is compared.

## Run the first slice

```text
npm test
npm run check
```

The source-of-truth v1 handoff remains in [BESTIARY-OF/tdotdh-field-guide](https://github.com/BESTIARY-OF/tdotdh-field-guide), with the instance pack in [MAPS-OF/SEDLEC-00Q](https://github.com/MAPS-OF/SEDLEC-00Q).
