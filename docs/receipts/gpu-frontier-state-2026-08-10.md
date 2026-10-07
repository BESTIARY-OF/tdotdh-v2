# GPU frontier state receipt — 2026-08-10

The v2 search worker now sends each selected frontier batch through a
parity-gated state-transition adapter. The adapter computes parent/candidate
occupancy union, translation-normalized partial-field masks, and a deterministic
state hash that includes the remaining-piece mask. The CPU oracle produces the
same buffers and hash; GPU output is accepted only when all buffers and hashes
match exactly.

The resulting state record is attached to each beam state without changing
SEDLEC family semantics. Piece-labeled canonicalization is intentionally still
outside this first state slice: the next step must carry per-piece occupancy
labels before GPU deduplication can safely replace the existing CPU family and
arrangement identity rules.

The realistic SEDLEC receipt exercises state-transition batches alongside
geometry batches: 3,376 breadth candidates, 3,443 depth candidates, and 1,565
target-family candidates where that path reaches frontier transitions.
