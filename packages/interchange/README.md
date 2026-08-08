# interchange

Versioned import/export manifests and migrations. Imports validate into a temporary namespace and activate atomically; a failed import leaves the active preset and bank unchanged.

## Package catalog

`package-catalog.v0.json` is the small, read-only catalog contract for the v2
workline. It records each app/package's declared capabilities, required
contracts, provided contracts, and implementation status. The catalog is
descriptive: it does not claim that a `contract-only` or `planned` entry has
an implementation.

The catalog's compatibility section establishes the v1 arrangement semantics
baseline, the browser module runtime, and the CPU-oracle-first policy. A
consumer may reject a catalog when its required contract is not supported,
without loading any package code or bank data.
