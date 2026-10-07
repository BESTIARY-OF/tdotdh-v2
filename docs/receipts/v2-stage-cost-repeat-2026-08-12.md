# v2 stage-cost repeat — 2026-08-12

## Live matched SEDLEC sample

Fixture: `SEDLEC-00Q_ISLAND-001`, port 5174, cache-buster
`20260812-costcompare2`.

- WebGPU path: `5,721.1 ms`;
- CPU oracle: `7,387.2 ms`;
- nodes: `3,348`;
- canonical signature: matched.

Worker stage totals:

- field metrics: `621.7 ms`;
- resident frontier state: `617.2 ms`;
- frontier topology: `404.3 ms`.

Cumulative topology attribution across 15 calls:

- CPU topology oracle: `15.1 ms`;
- CPU label reduction: `9.6 ms`;
- GPU summary: `27.9 ms`.

Compared with the previous stage-cost sample, the relative ordering changed
under browser scheduling noise. The two samples therefore establish a baseline
range, not a reliable winner for a stage-specific rewrite.

## Gate status

GPU frontier participation, canonical parity, and search semantics remain
verified. GPU-first completion remains open. Next action: use a controlled
multi-sample run or a lower-level dispatch benchmark before changing any of the
three similarly sized resident boundaries.
