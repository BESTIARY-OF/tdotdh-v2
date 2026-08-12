# v2 availability-cache repeat and resume gate — 2026-08-12

## Matched repeats

Fixture: `SEDLEC-00Q_ISLAND-001`, port 5174, worker cache-buster
`20260812-availabilitycache1`.

| Sample | GPU | CPU oracle | Nodes | Canonical parity |
| --- | ---: | ---: | ---: | --- |
| repeat 1 | 5,485.8 ms | 11,555.1 ms | 3,348 | true |
| repeat 2 | 4,429.0 ms | 6,091.5 ms | 3,348 | true |

Both repeats used the GPU worker path and matched the CPU canonical signature.
The samples are materially noisy, so they are recorded as evidence rather than
as a universal speedup claim.

## Cancellation/resume

The same worker passed the live cancellation/resume gate:

- cancelled at `98` nodes with a resumable checkpoint;
- resumed for `3,250` nodes;
- baseline completed at `3,348` nodes;
- `cancelledWithCheckpoint`, `resumedCompleted`,
  `canonicalSignatureMatch`, and `nodeCountMatch` were all true.

## Gate status

This validates that memoizing the field-metrics capability probe did not poison
canonical parity or resumability. GPU-first completion remains open pending
stable measured improvement across repeated supported-hardware runs. The next
optimization target remains resident frontier-state/topology overhead.
