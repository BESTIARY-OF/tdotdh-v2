import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { FRAME_WIDTH, countCells, createOccupancy, hasCell, intersects, placeRows, setCell } from "../src/occupancy.js";

const TILE = [0b111, 0b111, 0b111];
const GRID_STEP = 4;
const GRID_POSITIONS = Array.from({ length: FRAME_WIDTH / GRID_STEP }, (_, index) => index * GRID_STEP);
const BENCHMARK_PASSES = 512;
const BENCHMARK_OPERATION_LIMIT = BENCHMARK_PASSES * GRID_POSITIONS.length ** 2;

function assertKernelInvariants() {
  const field = createOccupancy();
  assert.equal(field.constructor, Uint32Array);
  assert.equal(field.length, FRAME_WIDTH);
  assert.equal(countCells(field), 0);

  setCell(field, 31, 31);
  assert.equal(hasCell(field, 31, 31), true);
  assert.equal(countCells(field), 1);

  const placed = createOccupancy();
  assert.equal(placeRows(placed, TILE, 4, 4), true);
  assert.equal(countCells(placed), 9);

  const beforeProbe = placed.slice();
  assert.equal(intersects(placed, TILE, 4, 4), true);
  assert.deepEqual(Array.from(placed), Array.from(beforeProbe));
  assert.equal(intersects(placed, [0b1], 0, 0), false);

  assert.equal(placeRows(placed, TILE, 4, 4), false);
  assert.equal(countCells(placed), 9);
  assert.equal(placeRows(placed, TILE, FRAME_WIDTH - TILE[0].toString(2).length, FRAME_WIDTH - TILE.length), true);
  assert.equal(countCells(placed), 18);
  assert.equal(hasCell(placed, 31, 31), true);
  assert.throws(() => setCell(placed, FRAME_WIDTH, 0), RangeError);
}

function runBoundedBenchmark(passes) {
  const startedAt = performance.now();
  let operations = 0;
  let finalCellCount = 0;

  for (let pass = 0; pass < passes; pass += 1) {
    const field = createOccupancy();
    for (const y of GRID_POSITIONS) {
      for (const x of GRID_POSITIONS) {
        assert.equal(placeRows(field, TILE, x, y), true);
        operations += 1;
      }
    }
    finalCellCount = countCells(field);
    assert.equal(finalCellCount, GRID_POSITIONS.length ** 2 * TILE.reduce((sum, row) => sum + row.toString(2).replaceAll("0", "").length, 0));
  }

  return { elapsedMs: performance.now() - startedAt, operations, finalCellCount };
}

assertKernelInvariants();
runBoundedBenchmark(16);
const result = runBoundedBenchmark(BENCHMARK_PASSES);
assert.equal(result.operations, BENCHMARK_OPERATION_LIMIT);
assert.ok(Number.isFinite(result.elapsedMs));
console.log(JSON.stringify({
  benchmark: "packed-occupancy-place-rows",
  passes: BENCHMARK_PASSES,
  operations: result.operations,
  finalCellCount: result.finalCellCount,
  elapsedMs: Number(result.elapsedMs.toFixed(2)),
  operationsPerSecond: Math.round(result.operations / (result.elapsedMs / 1000))
}));
