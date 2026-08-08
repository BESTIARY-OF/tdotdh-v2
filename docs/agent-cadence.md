# Agent cadence

The v2 workline uses a divided route so parallel time does not become a
human-facing wait state.

## Three phases

1. **Critical** — one owner handles the shortest path to the requested result.
   This is the only phase allowed to block a person waiting on a bugfix.
2. **Sidecar** — independent agents work in parallel on disjoint write scopes.
   Sidecars may add tests, fixtures, benchmarks, or package-local contracts,
   but they do not own the integration branch.
3. **Integration** — one owner reviews receipts, resolves conflicts, runs the
   full checks, and decides whether a release candidate is promotable.

`packages/orchestration/src/cadence.js` encodes this order and rejects
overlapping sidecar scopes before dispatch.

## Operating modes

### Human waiting on a bugfix

- Keep one agent on the critical fix.
- Assign at most one sidecar to a directly relevant regression test.
- Run the browser acceptance check as soon as the critical patch is ready.
- Defer broad surveys and refactors until the acceptance gate is green.

### Human away or working with another agent

- Fill the sidecar batches up to the available concurrency limit.
- Give each agent a named package or test-directory scope.
- Require a commit, changed-path list, and test receipt from every sidecar.
- Run one serial integration pass before publishing or handing off.

## Receipt contract

Every delegated task returns:

- status: completed, blocked, or needs-integration;
- changed paths and commit id;
- commands run and their result;
- unresolved acceptance gap, if any.

An idle agent is not an implicit continuation. The next route turn must either
dispatch a bounded follow-up or record that the line is idle.
