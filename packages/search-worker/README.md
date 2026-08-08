# search-worker

Worker protocol boundary. Every request carries `requestId`, preset/catalog fingerprints, a deterministic seed, budget, steering, and bounded signature hints. Every event carries `requestId` and monotonic `sequence`: `started`, `progress`, `result`, `completed`, `cancelled`, or `failed`.

The CPU implementation is the compatibility oracle. WebGPU may batch regular candidate scoring later; exact topology and cancellation remain CPU-controlled.
