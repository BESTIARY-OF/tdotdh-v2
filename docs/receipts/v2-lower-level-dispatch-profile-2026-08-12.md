# v2 lower-level dispatch profile — 2026-08-12

## Live matched SEDLEC benchmark

The live performance gate was rerun against the same
`SEDLEC-00Q_ISLAND-001` 15-piece fixture on port 5174, then its nested stage
receipts were inspected for dispatch-level timing fields.

| sample | GPU wall time | CPU wall time | nodes | canonical parity | CPU/GPU |
| --- | ---: | ---: | ---: | --- | ---: |
| dispatch profile | 4,991.7 ms | 9,404.4 ms | 3,348 / 3,348 | true | 1.884x |

The final instrumented frontier-metrics dispatch reported `107.1 ms` total,
including `0.1 ms` upload, `0 ms` submit, and `1.5 ms` readback. The final
resident-frontier-state dispatch reported `15.7 ms` total, including `15.6 ms`
readback. The final resident navigation-plan receipt reported
`4.1 ms` compact readback, `4.5 ms` count/select-scan readback, and `9.4 ms`
decode. These are terminal-call samples, not end-to-end sums: the search
performs multiple per-depth calls and the full wall time also includes browser
orchestration and other stages.

This confirms that result-boundary readback is measurable and small in the
sampled terminal dispatches, but does not by itself identify the dominant
end-to-end cost. GPU-first completion remains open pending cancellation/resume
parity and stable supported-hardware improvement.

Next bounded action: compare these dispatch-level fields across one matched
repeat, or instrument the remaining repeated frontier-metrics calls if the
variance persists.
