import assert from "node:assert/strict";
import { countCells, createOccupancy, hasCell, intersects, placeRows, setCell } from "../src/occupancy.js";

const field = createOccupancy();
setCell(field, 3, 3);
assert.equal(hasCell(field, 3, 3), true);
assert.equal(placeRows(field, [0b11, 0b1], 5, 4), true);
assert.equal(countCells(field), 4);
assert.equal(intersects(field, [0b11], 3, 3), true);
assert.equal(placeRows(field, [0b1], 3, 3), false);
console.log("packed occupancy smoke test passed");
