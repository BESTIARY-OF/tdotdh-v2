const DISPLAY_SCHEMA = "tdotdh.display-geometry/v0";
const CANONICAL_SCHEMA = "tdotdh.canonical-flatland/v0";

const PROJECTION_DIMENSIONS = Object.freeze({
  flatland: Object.freeze([2]),
  sphere: Object.freeze([2]),
  hypersphere: Object.freeze([3, 4]),
  cube: Object.freeze([3]),
  hypercube: Object.freeze([4]),
  simplex: Object.freeze([2, 3, 4])
});

function freezeRecord(record) {
  for (const value of Object.values(record)) if (value && typeof value === "object" && !Object.isFrozen(value)) freezeRecord(value);
  return Object.freeze(record);
}

function assertDimension(dimension) {
  if (!Number.isInteger(dimension) || dimension < 1) throw new RangeError(`display dimension must be a positive integer: ${dimension}`);
}

function embeddingDimension(kind, intrinsicDimension) {
  if (kind === "sphere") return 3;
  if (kind === "hypersphere") return intrinsicDimension + 1;
  return intrinsicDimension;
}

export function canonicalFlatlandCell(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new TypeError("canonical flatland cells require integer x and y");
  return Object.freeze({ x, y });
}

export function createDisplayGeometry({ kind = "flatland", dimension = 2 } = {}) {
  if (!Object.hasOwn(PROJECTION_DIMENSIONS, kind)) throw new RangeError(`unsupported display geometry: ${kind}`);
  assertDimension(dimension);
  if (!PROJECTION_DIMENSIONS[kind].includes(dimension)) {
    throw new RangeError(`unsupported ${kind} dimension ${dimension}; supported dimensions: ${PROJECTION_DIMENSIONS[kind].join(", ")}`);
  }

  return freezeRecord({
    schema: DISPLAY_SCHEMA,
    canonical: {
      schema: CANONICAL_SCHEMA,
      geometry: "flatland",
      dimension: 2,
      coordinateType: "integer-cell",
      axisOrder: ["x", "y"],
      handedness: "right-handed",
      origin: "dataset-defined",
      authoritative: true
    },
    target: {
      kind,
      intrinsicDimension: dimension,
      embeddingDimension: embeddingDimension(kind, dimension),
      projectionId: `tdotdh/${kind}/d${dimension}/v0`,
      transform: "deferred",
      implementation: "metadata-only"
    },
    determinism: {
      metadataVersion: 0,
      coordinateOrder: "row-major-y-then-x",
      preservesCanonicalCoordinates: true
    }
  });
}

export { CANONICAL_SCHEMA, DISPLAY_SCHEMA, PROJECTION_DIMENSIONS };
