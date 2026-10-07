# v2 controlled stage samples — 2026-08-12

## Controlled matched pair

Each run used a fresh benchmark page and the same `SEDLEC-00Q_ISLAND-001`
fixture on port 5174.

| Run | GPU | CPU oracle | Nodes | Parity | Field metrics | Resident state | Topology |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| controlled 1 | 5,409.9 ms | 8,499.7 ms | 3,348 | true | 444.9 ms | 463.7 ms | 397.8 ms |
| controlled 2 | 4,518.7 ms | 7,741.2 ms | 3,348 | true | 577.2 ms | 380.3 ms | 358.3 ms |

Pair medians: field metrics `511.0 ms`, resident state `422.0 ms`, topology
`378.1 ms`. Topology split attribution was respectively `31.6 ms` and
`29.9 ms` GPU summary, with CPU oracle/reduction totals of `21.1/20.3 ms` and
`18.6/23.6 ms`.

The pair confirms GPU improvement and canonical parity but still shows enough
browser scheduling variance that no single stage is a safe optimization target.

## Gate status and next action

No search semantics, ticket order, cancellation behavior, or result-boundary
readback changed. GPU-first completion remains open pending broader repeated
measurements. Next action: use a lower-level dispatch benchmark or collect one
more controlled pair before altering resident state, topology, or field metrics.
