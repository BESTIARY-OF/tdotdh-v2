# GPU resident-state upload allocation receipt — 2026-08-12

## Live verification

The updated `d71a96d` resident frontier-state path was exercised through the
live v2 performance page with the published `SEDLEC-00Q_ISLAND-001` fixture:

- GPU path: 3,193.4 ms, 3,348 nodes
- forced CPU oracle: 4,319.9 ms, 3,348 nodes
- canonical signature parity: true
- cancellation/resume: checkpoint returned, resumed completion true,
  canonical signature match true, node-count match true

The change removes temporary JavaScript-array materialization for resident
candidate indices and output slots. This is a live correctness/performance
receipt, not GPU-first completion: the remaining end-to-end cost is still
distributed across multiple frontier stages and must be measured before further
algorithmic changes.
