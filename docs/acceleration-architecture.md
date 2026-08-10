# Acceleration architecture

The v2 acceleration boundary has two independent surfaces.

## Search

The CPU implementation is the oracle. A future compute-shader adapter receives
the same deterministic family ticket, mode (`breadth` or `depth`), run seed,
and resumable cursor. It may batch candidate generation and occupancy checks on
the GPU, but it must return canonical arrangement signatures that the CPU can
replay. A signature mismatch is a correctness failure, not a performance
tradeoff. If the adapter is unavailable, the coordinator falls back to CPU and
records that fact in the receipt.

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
4. CPU/GPU parity fixture.
5. Only then: WebGPU throughput benchmark and windowed renderer benchmark.

## Current receipt

The v2 workline has completed gates 1–3 and has working parity-gated slices for
gate 4:

- 560c1ff executes a real WebGPU candidate-scoring dispatch with a CPU hash
  reference.
- ef04cdc adds the WebGPU occupancy prefilter and wires its CPU parity check
  into the runtime.
- d25a961 connects the prefilter to the resumable CPU worker, preserving
  ticket, cursor, cancellation, and canonical-signature ownership.
- 4ec5083 adds the coordinate-preserving renderer capability boundary.
- e4dcba4 adds an end-to-end worker receipt test proving the adapter hook is
  consulted.

The browser must still demonstrate the GPU validity mask matching the CPU
oracle on a real field-guide candidate batch before the UI may claim accelerated
search. Until then the product remains correctly labeled CPU-oracle-first.
