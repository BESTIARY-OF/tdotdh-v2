# GPU persistence and renderer smoke receipt — 2026-08-11

## Scope

Read-only verification of the committed v2 product, with the separate preview
on `http://127.0.0.1:5174/`. No v1 files or staging state were changed.

## Evidence

- The preview loaded the SEDLEC product page and reported `V2 product · GPU
  smoke parity verified · real search receipt pending`.
- The browser changed `#searchStrategy` to `depth`, reloaded the page, and the
  selected option restored as `family depth`.
- The prior `balanced` setting was restored after the check.
- `node packages/browser-handoff/test/renderer-boundary.test.js` passed.
- `node packages/browser-handoff/test/renderer-adapter-capability.test.js`
  passed.
- `node apps/field-guide/test/product-bundle.test.js` passed.
- `node apps/field-guide/test/v2-search-receipt.test.js` completed without
  failure output.

## Runtime boundary

The v2 preview was listening on port 5174. A read-only listener check found no
listener on port 5173 at the time of this receipt. This is recorded as an
environment/runtime gap; it is not evidence that v1 staging should be changed.

## Interpretation

Persistence and renderer contracts are currently verified for the preview.
The GPU-first milestone remains open: realistic SEDLEC runs have exact CPU
canonical-signature parity and modest host-specific improvement, but the
broader supported-hardware performance gate is not yet proven.
