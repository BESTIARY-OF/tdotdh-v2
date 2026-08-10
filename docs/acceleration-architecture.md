# Acceleration architecture

The v2 acceleration boundary has two independent surfaces.

## Search

The CPU implementation is the oracle. Compute-shader adapters receive the same
deterministic family ticket, mode (`breadth` or `depth`), run seed, and
resumable cursor. The current navigation path batches occupancy prefiltering,
frontier generation, target-pool classification, field aggregates, geometry,
state transitions, topology, ranking, and hash-first frontier deduplication on
the GPU when each adapter
passes parity. Beam retention now uses a GPU top-K compactor after the ranker;
depth mode supplies score keys directly, while breadth mode encodes the existing
family round-robin quota as stable `(round, bucket-order)` keys. The compactor
returns only the bounded winner set and its CPU oracle verifies the exact index
order. Family/locked branches use the target-pool contract too; they no
longer have a special implicit CPU-only target gate.

The GPU may return compact candidates and scores, but it must return canonical
arrangement signatures that the CPU can replay. A signature mismatch is a
correctness failure, not a performance tradeoff. If an adapter is unavailable
or fails parity, the coordinator falls back to CPU and records that fact in the
receipt. The navigation coordinator now issues deterministic per-stage batch
tickets, carries their cursors into generation receipts, and records
cancellation checks before and after a GPU expansion layer. Ticketing, cursor
arbitration, checkpoint serialization, and final canonical acceptance remain
CPU-owned until the end-to-end navigator parity gate is closed. The product
worker carries a bounded versioned beam checkpoint through the cursor and
persists it across a reload; GPU state is recomputed on resume rather than
trusted from storage.

The worker boundary remains responsible for cancellation acknowledgement,
checkpoint persistence, and ordered result delivery. GPU dispatch must not make
those lifecycle guarantees implicit.

## Display

Flatland world coordinates remain the source of truth. Rendering receives a
projection descriptor and produces display coordinates; it does not rewrite the
arrangement. The first descriptor is flatland. Future descriptors may target
sphere, hypersphere, cube, hypercube, or simplex views, with explicit dimension
and backend capability checks. This keeps v3 geometry experiments from leaking
back into v2 solver semantics.

## Gate sequence

1. CPU fixture and canonical signature.
2. Worker receipt and cancellation behavior.
3. Adapter contract and unavailable fallback.
4. CPU/GPU parity fixture for each navigation stage.
5. Real worker receipt proving the adapters execute inside the product worker.
6. End-to-end navigator parity: batch candidate expansion, deduplication,
   ranking, cursor advancement, cancellation, checkpoint resume, and
   canonical signatures.
7. Only then: WebGPU throughput benchmark and windowed renderer benchmark.

## Current receipt

The v2 workline has completed gates 1–5 for the current adapter slices and has
not completed gate 6:

- 560c1ff executes a real WebGPU candidate-scoring dispatch with a CPU hash
  reference.
- ef04cdc adds the WebGPU occupancy prefilter and wires its CPU parity check
  into the runtime.
- d25a961 connects the prefilter to the resumable CPU worker, preserving
  ticket, cursor, cancellation, and canonical-signature ownership.
- 4ec5083 adds the coordinate-preserving renderer capability boundary.
- e4dcba4 adds an end-to-end worker receipt test proving the adapter hook is
  consulted.
- 90f9c19 moves beam target selection behind a parity-gated GPU target pool,
  including the family/locked branch path.
- 9e985c7 covers WGSL compound-statement portability and empty-field bounds
parity in the field-metrics shader.
- The dedup seam is hash-first on the GPU and exact-signature gated by the CPU
  oracle; hash collisions or unavailable dispatch leave CPU admission unchanged.
- `79301c6` hardens the worker transport and real product-worker receipt path:
  terminal cursors remain monotonic, result envelopes cannot be overwritten by
  search payload fields, and the runtime test covers `started → progress →
  result → completed`.
- The navigation receipt now exposes deterministic stage batch ordinals and
  cancellation-check counts; these are the next evidence surface for closing
  gate 6 rather than treating GPU dispatch as an opaque side effect.
- `859ff38` extends that receipt with `expansionBackend`, `expansionParity`,
  `expansionOwnership`, and `gpuExpansionBatches`. The product and realistic
  fixture benchmark now exercise the same coordinator lifecycle. `45877fe`
  removes a duplicate CPU candidate-generation pass after GPU frontier origins
  have been returned; the remaining CPU work is an explicit target-index join,
  not a second search of the candidate space.
- `6094ddf` adds a bounded persistent-frontier payload with digest-bound cursor
  resume, stable CPU compaction oracle, and an explicit GPU compaction handoff.
- The follow-on persistent compactor keeps the WebGPU input/output storage
  buffers, uniform buffer, readback buffer, and bitonic pipeline alive across
  compaction calls. Each call overwrites the bounded allocation, performs the
  GPU sort, and admits the result only after exact CPU index parity. Device
  loss destroys the allocation and resets the shared device cache, so the next
  call can re-probe cleanly. This is a real persistent allocation seam; it is
  not yet the full GPU-resident frontier-state owner.
- The labeled frontier-state transition now uses a second persistent device
  allocation for parent labels, candidate masks, remaining-piece masks,
  output labels, hashes, parameters, and readback. Its pipeline and bind group
  are reused across transition batches, and the CPU labeled-state transition
  remains the exact parity gate. This is the first persistent GPU state seam
  used by the product worker, not just an isolated contract test.

The resident frontier navigator now wraps that adapter in the product worker.
It owns a runtime-local epoch and digest-bound GPU residency token, exchanges
deterministic batch tickets and monotonic cursors, refuses stale cursor reuse,
and checkpoints before cancellation can commit a new epoch. The token never
crosses `postMessage`, localStorage, or a durable checkpoint: only its digest,
cursor, and canonical replay receipt do. This makes GPU ownership observable in
the live search path while keeping the CPU arrays as the exact replay oracle.
The remaining gate is to make the next beam's parent labels reference the
resident GPU epoch directly, eliminating the current per-transition label
materialization rather than merely hiding it behind the navigator.

That parent-reference seam is now implemented by
`webgpu-resident-frontier-state.js`: a double-buffered resident label pool
accepts indexed parent states, dispatches bounded batches into the opposite
generation, and swaps only at `commitLayer`. The product search attaches the
resulting resident slot/epoch to each beam state, so the next layer submits
parent indices instead of rebuilding parent labels as its GPU input. The CPU
arrays remain readback-only parity evidence and final canonical replay data.
The next active gate is broader GPU ownership of candidate generation,
target-index joins, and score/metric reductions; those are still CPU-visible
control decisions even though their parity-gated adapters exist.

The live 5174 runtime receipt for this seam is recorded in
`docs/receipts/webgpu-deduplicator-runtime-2026-08-10.md`.

Committed runtime receipts in `docs/receipts/` prove real Chrome/D3D11 dispatch
for the candidate scorer and occupancy prefilter, including a measured
prefilter improvement on that fixture. They do not prove the full variable-field
navigator is GPU-first yet; gate 6 remains the active milestone.
