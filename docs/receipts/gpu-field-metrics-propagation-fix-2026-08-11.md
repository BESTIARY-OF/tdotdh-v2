# GPU field-metrics propagation fix — 2026-08-11

## Change

The resident outside-label propagation shader treated an unlabeled empty cell as permanently blocked. It could therefore never acquire a label from an adjacent outside cell, and the GPU field-metrics pass reported valid first-layer candidates as holes. The fix marks occupied cells with an explicit sentinel, preserves that sentinel during propagation, and allows empty cells to adopt the minimum non-sentinel neighbour label.

The search and worker imports were cache-busted to `floodfill6`; the matched performance route now uses worker revision `matched98`. `apps/field-guide/product/performance.html` exposes the matched gate without relying on the browser-blocked `benchmark.html` path.

## Verification

- `npm test` passed, including field-metrics, search receipt, cancellation, worker runtime, and renderer tests.
- Default matched SEDLEC run after the fix: GPU `8,986.5 ms`, CPU `8,424.3 ms`; both visited `3,348` nodes, found an arrangement, and matched canonical signatures. GPU field metrics reported `webgpu / verified`; navigation completed.
- Two warm repeats: GPU `13,297.6 ms` vs CPU `14,660.0 ms` (1.102× CPU-over-GPU), and GPU `12,801.1 ms` vs CPU `13,314.6 ms` (1.040×).
- The pre-fix diagnostic with GPU field metrics disabled completed at GPU `11,194.3 ms` vs CPU `11,788.1 ms`, confirming that the propagation bug—not the rest of the resident pipeline—was the reason the default GPU run stopped at `15` nodes.

These are three browser samples on one supported adapter, so they are evidence of a restored full GPU path and a modest warm-run improvement, not yet a stable cross-hardware performance claim. CPU canonical replay, cancellation/resume, and repeated realistic benchmarking remain release gates.
