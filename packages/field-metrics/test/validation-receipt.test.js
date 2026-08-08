import assert from "node:assert/strict";
import { FIELD_METRICS_SCHEMA } from "../src/schema.js";

// Contract-only fixture: these values are intentionally deterministic and do
// not claim to be a captured island. It gives UI and worker implementations a
// single shape to validate before they share a calculator.
const VALIDATION_RECEIPT = {
  schemaVersion: FIELD_METRICS_SCHEMA,
  metricProfile: "orthogonal-coast-v1",
  validation: {
    status: "valid",
    complete: true,
    connected: true,
    holes: { count: 0, zero: true },
    coverage: {
      expectedCells: 135,
      occupiedCells: 135,
      uniqueCells: 135,
      overlapCellCount: 0,
      overlapUnitCount: 0,
      ratio: 1,
      complete: true
    },
    centroidLandlocked: true,
    strongEnclosure: true
  },
  geometry: {
    area: 135,
    bounds: { minX: -9, maxX: 9, minY: -7, maxY: 7 },
    width: 19,
    height: 15,
    density: 0.47368421052631576
  },
  coastline: {
    edgeCount: 92,
    meanRadius: 6.25,
    radialStdDev: 1.125
  },
  inletRisk: {
    score: 3.25,
    inletCells: 2,
    inletEdges: 3,
    peninsulaDepth: 1,
    nestedPeninsulaDepth: 0,
    terminalChains: 0
  },
  centroid: {
    id: 3,
    cellCount: 9,
    point: { x: 0.5, y: 0.5 },
    neighborCount: 6,
    familyId: "F-FIXTURE6",
    seed: "#01[...]|#02[...]|#04[...]|#21[...]|#26[...]|#43[...]",
    edgeCoast: false,
    cornerCoast: false,
    enclosure: "strong",
    fieldCenter: { x: 0.5, y: 0.5 },
    centerSquare: { x: 0, y: 0 },
    centerOffset: 0,
    centerSquareOffset: 0.7071067811865476
  },
  ranking: {
    baseScore: 9200123.5,
    qualityScore: 9200123.5,
    components: {
      coastline: 92,
      enclosure: 0,
      radial: 1125,
      gravity: 0,
      center: 0.7071067811865476,
      density: 0.5263157894736842,
      inlet: 3.25
    }
  }
};

const FINITE_NUMERIC_PATHS = [
  ["geometry", "area"],
  ["geometry", "density"],
  ["coastline", "edgeCount"],
  ["coastline", "meanRadius"],
  ["coastline", "radialStdDev"],
  ["inletRisk", "score"],
  ["centroid", "neighborCount"],
  ["ranking", "baseScore"],
  ["ranking", "qualityScore"]
];

assert.equal(VALIDATION_RECEIPT.schemaVersion, "tdotdh.field-metrics/v2");
assert.equal(VALIDATION_RECEIPT.validation.coverage.expectedCells, 15 * 9);
assert.equal(VALIDATION_RECEIPT.validation.coverage.ratio, 1);
assert.equal(VALIDATION_RECEIPT.validation.holes.zero, true);
assert.equal(VALIDATION_RECEIPT.validation.centroidLandlocked, true);
assert.equal(VALIDATION_RECEIPT.centroid.enclosure, "strong");
assert.equal(VALIDATION_RECEIPT.centroid.neighborCount, 6);

for (const path of FINITE_NUMERIC_PATHS) {
  const value = path.reduce((current, key) => current[key], VALIDATION_RECEIPT);
  assert.equal(Number.isFinite(value), true, `${path.join(".")} must be finite`);
}

const encoded = JSON.stringify(VALIDATION_RECEIPT);
assert.equal(JSON.stringify(JSON.parse(encoded)), encoded, "receipt JSON must be byte-stable");
assert.equal(encoded.includes("Infinity"), false);
assert.equal(encoded.includes("NaN"), false);

console.log("field-metrics v2 validation receipt passed");
