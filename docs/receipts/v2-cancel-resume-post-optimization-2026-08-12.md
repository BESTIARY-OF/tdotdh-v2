# v2 cancellation/resume post-optimization gate — 2026-08-12

## Live SEDLEC verification

The live `cancel-resume` performance gate was run after the frontier-metrics
redundant-copy removal, against `SEDLEC-00Q_ISLAND-001` on port 5174.

| check | result |
| --- | --- |
| cancellation delivered | true |
| checkpoint returned | true |
| cancellation node offset | 98 |
| resumed node count | 3,250 |
| resumed cumulative node offset | 3,348 |
| fresh baseline node count | 3,348 |
| resumed completed | true |
| canonical signature match | true |
| node count match | true |

The resumed run and fresh baseline produced the same canonical arrangement.
This verifies that the current GPU-first path preserves the resumable cursor
contract and CPU canonical-signature parity after the metrics dispatch change.
It is a correctness gate, not a throughput measurement.

Next bounded action: continue with a paired performance sample or inspect the
remaining high-cost frontier-metrics dispatches; no additional cancellation
work is required for this gate.
