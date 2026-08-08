/**
 * Versioned orientation vocabulary for saved arrangement pieces.
 *
 * `cells` on an arrangement piece are authoritative world coordinates. They
 * have already been transformed and must not be transformed again by a
 * viewer. `transformLocalCells` is only for catalog/source-shape previews.
 */

export const ORIENTATION_SCHEMA = "tdotdh.orientation.v1";
export const NONOMINO_AREA = 9;

export const TRANSFORMS = Object.freeze([
  "identity",
  "rotate-90",
  "rotate-180",
  "rotate-270",
  "flip-x",
  "flip-y",
  "flip-xy"
]);

const TRANSFORM_ALIASES = Object.freeze({
  fixed: "identity",
  identity: "identity",
  "x-flipped": "flip-x",
  "y-flipped": "flip-y",
  "x-and-y-flipped": "flip-xy"
});

export const AXES = Object.freeze({
  x: "east-positive-horizontal",
  y: "south-positive-vertical"
});

export function canonicalTransform(value = "identity") {
  const canonical = TRANSFORM_ALIASES[value] || value;
  if (!TRANSFORMS.includes(canonical)) throw new TypeError(`unsupported transform: ${value}`);
  return canonical;
}

function copyCell(cell) {
  if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
    throw new TypeError("cells must contain integer x/y coordinates");
  }
  return { x: cell.x, y: cell.y };
}

export function normalizeLocalCells(cells) {
  if (!Array.isArray(cells) || cells.length === 0) throw new TypeError("cells must be a non-empty array");
  const copied = cells.map(copyCell);
  const unique = new Set(copied.map(cell => `${cell.x},${cell.y}`));
  if (unique.size !== copied.length) throw new RangeError("cells must be unique");
  const minX = Math.min(...copied.map(cell => cell.x));
  const minY = Math.min(...copied.map(cell => cell.y));
  return copied
    .map(cell => ({ x: cell.x - minX, y: cell.y - minY }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function transformLocalCells(cells, transform = "identity") {
  const canonical = canonicalTransform(transform);
  const source = normalizeLocalCells(cells);
  const width = Math.max(...source.map(cell => cell.x)) + 1;
  const height = Math.max(...source.map(cell => cell.y)) + 1;
  const transformed = source.map(cell => {
    if (canonical === "flip-x" || canonical === "flip-xy") {
      return { x: width - 1 - cell.x, y: canonical === "flip-xy" ? height - 1 - cell.y : cell.y };
    }
    if (canonical === "flip-y") return { x: cell.x, y: height - 1 - cell.y };
    if (canonical === "rotate-90") return { x: height - 1 - cell.y, y: cell.x };
    if (canonical === "rotate-180") return { x: width - 1 - cell.x, y: height - 1 - cell.y };
    if (canonical === "rotate-270") return { x: cell.y, y: width - 1 - cell.x };
    return cell;
  });
  return normalizeLocalCells(transformed);
}

export function validateArrangementPiece(piece) {
  if (!piece || typeof piece !== "object") throw new TypeError("arrangement piece must be an object");
  const permutation = piece.permutation_number ?? piece.permutation;
  if (!Number.isInteger(permutation) || permutation < 1) throw new TypeError("permutation must be a positive integer");
  const suppliedTransform = piece.transform ?? piece.shape_transform ?? "identity";
  const transform = canonicalTransform(suppliedTransform);
  const cells = Array.isArray(piece.cells) ? piece.cells.map(copyCell) : null;
  if (!cells || cells.length !== NONOMINO_AREA) throw new RangeError(`arrangement pieces must contain exactly ${NONOMINO_AREA} cells`);
  const unique = new Set(cells.map(cell => `${cell.x},${cell.y}`));
  if (unique.size !== cells.length) throw new RangeError("arrangement world cells must be unique");
  return {
    permutation_number: permutation,
    shape_transform: transform,
    cells: cells.sort((a, b) => a.y - b.y || a.x - b.x)
  };
}
