# v2 cancellation/resume display resilience — 2026-08-12

## Search gate

- Fixture: `SEDLEC-00Q_ISLAND-001`
- Cancelled at `98` nodes with a checkpoint
- Resumed nodes: `3,250`
- Baseline nodes: `3,348`
- `cancelledWithCheckpoint=true`
- `resumedCompleted=true`
- `canonicalSignatureMatch=true`
- `nodeCountMatch=true`

## Display gate after resume

- Product URL: `http://127.0.0.1:5174/?v=20260812-rendercancelgate1`
- Field: `20 × 11`
- Coverage: `135 / 135 squares`
- WebGPU overlay: one canvas, `data-renderer-status=rendered`
- Runtime status: `GPU smoke parity verified`

The renderer remained usable after a checkpointed search and resumed result. Renderer-unavailable behavior is separately covered by the adapter tests and removes the overlay on explicit failure.
