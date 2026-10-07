# v2 preview boundary recovery — 2026-08-13

## Observation

At the 19:02 heartbeat, both local preview ports refused connections even
though the v2 code and focused verification gates passed. The source tree was
intact; the listener processes had simply stopped.

## Recovery

- Restarted `apps/field-guide/serve.mjs` on `127.0.0.1:5174` from the v2
  workline.
- Restarted the preserved v1 `index.html` root with Python HTTP serving on
  `127.0.0.1:5173`.
- No source files, v1 files, or user changes were modified.

## Verification

Both boundaries returned HTTP 200 after restart:

| boundary | status | response bytes |
| --- | ---: | ---: |
| v1 `127.0.0.1:5173/` | 200 | 17,827 |
| v2 `127.0.0.1:5174/` | 200 | 18,090 |

This restores the human-reviewable local preview boundary. It does not claim
GPU-first completion; the active GPU frontier, parity, cancellation/resume,
and measured-improvement gates remain in force.
