import assert from "node:assert/strict";
import { canonicalTransform, normalizeLocalCells, transformLocalCells, validateArrangementPiece } from "../src/orientation-contract.js";

assert.equal(canonicalTransform("fixed"), "identity");
assert.deepEqual(normalizeLocalCells([{ x: 4, y: 6 }, { x: 3, y: 6 }, { x: 3, y: 7 }]), [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 }
]);
assert.deepEqual(transformLocalCells([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], "rotate-180"), [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 }
]);

const piece = validateArrangementPiece({
  permutation_number: 1,
  transform: "fixed",
  cells: Array.from({ length: 9 }, (_, index) => ({ x: index % 3, y: Math.floor(index / 3) }))
});
assert.equal(piece.shape_transform, "identity");
assert.equal(piece.cells.length, 9);
assert.throws(() => validateArrangementPiece({ permutation_number: 1, cells: [] }), /exactly 9/);

console.log("orientation contract tests passed");
