# v2 steering-change GPU recovery receipt — 2026-08-13

## Scope

This receipt covers the published `apps/field-guide` v2 entrypoint on local port
`5174`. It verifies that changing rank-steering controls does not strand the
next search pass in terminal CPU replay while a usable WebGPU device remains
available.

## Reproduction and fix

Before the fix, a persisted continuation checkpoint plus a fired-but-still
truthy auto-search timer could leave the UI at `GPU device ready · 0 GPU stages`
after steering changes. Changing the control back did not reliably schedule a
new pass.

Commit `bd13186` now:

- invalidates the search checkpoint and steering schedule when search settings,
  family weights, placement hints, or locks change;
- terminates the stale worker and schedules a fresh pass when auto-search is
  active;
- clears the timer reference at the start of every pass; and
- clears stale continuation state when a new search is explicitly started.

## Live verification

In the local v2 preview, while auto-search was active, Coast was changed from
`3×` to `4×` and then back to `3×`.

- During transition: `Search steering changed · restarting GPU search`.
- After the returned pass: `GPU device ready · 10 GPU stages · 0 CPU fallbacks`.
- Stage availability: all adapters available.
- The result remained a normal GPU family-grid search; it did not remain at
  zero GPU stages.

This was verified in the Codex in-app browser. Firefox verification remains a
separate manual check; this receipt does not claim it.

## Automated checks

Passed:

- `node --check apps/field-guide/product/app.js`
- `node apps/field-guide/test/product-bundle.test.js`
- `node apps/field-guide/test/v2-search-cancellation.test.js`
- `node apps/field-guide/test/v2-worker-runtime.test.mjs`
- `git diff --check`

The CPU implementation remains the hidden correctness oracle, and this fix
does not relax GPU parity gates or change renderer semantics.

## Multi-family and weight-steering follow-up

During the 08:47 heartbeat, the live 5174 page had two weighted families
selected (`F-05NMZZD` and `F-0C9UBKH`, both checked). Neighbors steering was
changed to `exactly 5`, Coast was changed from `3×` to `4×` and restored to
`3×`, and the page completed the restarted passes with:

`V2 product · GPU device ready · 10 GPU stages · 0 CPU fallbacks · 3 not used`

The final snapshot retained both family selections, `exactly 5` neighbors, and
Coast `3×`. This confirms that the live steering path remains GPU-first after a
multi-family neighbor change and a rank-steering change; it does not claim
Firefox-specific verification.

## Live receipt follow-up

At the 09:47 heartbeat, the current 5174 product tab reported a completed pass
of `25,376 ms` with `10 GPU stages`, `0 CPU fallbacks`, and `3 not used`, with
the execution decision `GPU-first` and all adapters available. Both weighted
family controls remained checked (`F-05NMZZD` and `F-0C9UBKH`), and the selected
family continued to report weighted depth `4.0×`. This verifies the published
runtime receipt after steering changes; Firefox-specific verification remains
manual.
