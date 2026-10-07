# GPU resident output-index reuse cancellation repeat

Date: 2026-08-12
Commit under test: `c496e35`

## Live cancellation/resume

The committed v2 build was rerun against the SEDLEC cancellation fixture on port 5174:

- cancellation checkpoint: node 98, depth 2, cursor offset 98
- resumed result: 3,250 newly processed nodes, cursor offset 3,348
- uninterrupted baseline: 3,348 nodes
- checkpoint captured: true
- resume completed: true
- canonical signature match: true
- node count match: true

This independently confirms that the shared publication-index buffer does not change resumable cursor semantics or canonical result identity.
