# Field-guide product port

This directory is the v2 monorepo's runnable port of the published TDOTDH field guide.
It carries the complete SEDLEC-00Q opinionated set, its recovered arrangement bank,
family records, steering state, and the real variable-field search worker. The v2
server exposes it at `/` on the preview port (5174 in development).

The product keeps the CPU worker as the correctness oracle while moving the hot
frontier path behind parity-gated WebGPU adapters. Candidate occupancy, frontier
generation and deterministic compaction, frontier validity/scoring, and frontier
geometry reduction (contact, centroid contact, ring coverage, open-ring count,
combined bounds area, and beam geometry score), and piece-labeled partial-field
state transition (per-piece occupancy labels, translation-normalized labels, and
remaining-piece mask) now have explicit GPU contracts. Verified labeled state
keys are used for safe beam deduplication: absolute piece labels plus remaining
pieces are required, so translated or differently assigned fields are never
conflated.
When WebGPU is available and exact parity holds, the product uses those GPU results
to rank and, in depth mode, top-K compact the next beam; otherwise each slice reports an explicit CPU fallback. Full
topology acceptance now has a final parity-gated GPU occupancy reduction; its
Perimeter, centroid edge/corner coast, and bounding-box area remain
CPU-oracle-derived inside that adapter,
while component labels and empty-region flood labels now drive parity-gated
hole/connectivity reduction.
When the adapter is available, candidate frontiers are submitted through its
batch topology contract for GPU ranking; unavailable adapters return before
doing per-candidate topology work. Cancellation/control flow, and persistence remain CPU-owned, while final
canonical signature generation is parity-checked from the GPU-derived labeled
state. The worker also exposes a protocol-native
`frontier-batch` operation with
cursor-selected candidates, canonical signatures, and resumable receipts.

During product search, the retained beam is flattened at each layer before
frontier validity/scoring dispatch. The GPU receives one layer-sized batch
across all beam states, while the product receipt carries the worker ticket
and cursor used for that dispatch. Candidate-to-state remapping and CPU
canonical admission remain deterministic after readback.

When WebGPU is available, frontier generation is issued as one flattened batch
for all retained beam states and their remaining pieces, chunked only at the
adapter's storage safety limit. The batch shader emits deterministic origins
and validity masks, and the CPU oracle compares every item before the candidates
re-enter target selection. This removes the prior one-state-at-a-time dispatch
pattern from the GPU path while preserving CPU fallback and cursor semantics.

The target-aware frontier contract is the preferred breadth/depth path: it
enumerates only target-contact × piece-source pairs, performs occupancy,
bounds, and position-lock checks in the compute shader, and returns candidates
already keyed to the target cell. This avoids generating every field-cell
direction and then rediscovering the selected target on the CPU. The older
all-frontier generator remains available for recursive compatibility and
fallback.

Before target×piece generation, a target-pool contract now classifies every
retained state's open cells into ordinary frontier cells and centroid-ring
cells in one batched occupancy-neighborhood dispatch. The CPU preserves the
legacy insertion order when consuming the parity-verified masks, so SEDLEC
beam semantics remain unchanged while target eligibility is GPU-first.

The branch-ranking boundary is also parity-gated. Candidate scores and stable
ties are submitted to a multi-pass bitonic WebGPU sort over a padded storage
buffer, so family buckets are no longer capped at 128 rows or silently sorted
by JavaScript. The CPU ordering oracle rejects any divergent index order.
The search receipt calls this `GPU deterministic ranking`; unavailable or
device-capacity-limited batches use the same CPU comparator without changing
beam semantics.

Beam retention has a separate `webgpu-frontier-compactor.v0` contract. In depth
mode the bitonic shader returns the deterministic top-K state indices. In
breadth mode the CPU derives the existing family round-robin policy as stable
`(round, bucket-order)` keys, and the same shader selects its bounded quota
without changing the policy. The CPU oracle compares every bounded result
before state remapping.

The next field-wide seam is now explicit as `webgpu-field-metrics.v0`. For every
surviving branch it batches the occupied and centroid masks and computes the
integer aggregates that dominate repeated field scans: area, perimeter, bounds,
coordinate sums, and edge/corner coast flags. The CPU uses those verified
  aggregates to finish floating-point quality terms and family naming. The pass
  includes area, perimeter, bounds, coordinate sums, coast flags, and exact
  exterior-masked inlet-cell/inlet-edge counts. This keeps
  locked-seed and target-family construction on the same batched contract as
  breadth/depth beam expansion, with selected candidates flattened across a
  beam depth before dispatch.
the GPU path broad without accepting adapter-dependent floating-point ordering;
the receipt reports `GPU field aggregates` only after exact integer parity.

Family derivation now consumes the labeled-state readback rather than rescanning
all placed cells. Only the centroid boundary is inspected on the CPU to rebuild
the existing contact signature and FNV family ID, so GPU-labeled state is the
source of truth while the public family identifiers remain unchanged.

Beam deduplication is likewise hash-guided: the GPU labeled-state pass supplies
an absolute state hash, and the CPU performs the full label comparison only for
hash collisions. No correctness decision relies on a hash alone, and the CPU
fallback retains the previous exact arrangement-signature behavior.
