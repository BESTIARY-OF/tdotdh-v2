# v2 flatland render timing — 2026-08-12

## Isolated instrumentation

The WebGPU flatland renderer now reports its own submission-path elapsed time on the overlay canvas as `data-renderer-elapsed-ms`. This timing is intentionally outside the search receipt and does not affect search-node, canonical-parity, cancellation, or CPU-oracle measurements.

## Live verification

- URL: `http://127.0.0.1:5174/?v=20260812-render-timing1`
- Overlay status: `rendered`
- Isolated renderer elapsed time: `75.2 ms`
- Search receipt: unchanged/not injected by the display timing path
- Renderer, product-bundle, and boundary focused tests passed

This is a single browser sample, useful for instrumentation validation rather than a performance claim. Future renderer backends remain behind the same boundary.
