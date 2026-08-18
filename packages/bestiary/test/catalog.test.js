import assert from 'node:assert/strict';
import { analyzePolyomino, canonicalPolyomino, createCatalogRecord, enumerateMobPlacements, enumeratePolyominoes, mobPlacementSequence } from '../src/catalog.js';

const shapes = enumeratePolyominoes(4, { limit: 5 });
assert.equal(shapes.length, 5);
assert.equal(new Set(shapes.map(shape => shape.canonical)).size, 5);
assert.deepEqual(shapes[0].cells, [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }]);
assert.equal(analyzePolyomino(shapes[0].cells).perimeter, 10);
assert.equal(canonicalPolyomino([{ x: 1, y: 0 }, { x: 0, y: 0 }]), canonicalPolyomino([{ x: 0, y: 0 }, { x: 0, y: 1 }]));
const originalCatalog = enumeratePolyominoes(9, { limit: 100 });
assert.equal(originalCatalog.length, 100);
assert.equal(originalCatalog[0].ordinal, 1);
assert.equal(originalCatalog.at(-1).ordinal, 100);

assert.deepEqual(mobPlacementSequence({ yang: 2, yin: 2, strategy: 'yang-first' }), ['yang', 'yang', 'yin', 'yin']);
assert.deepEqual(mobPlacementSequence({ yang: 2, yin: 2, strategy: 'yin-first' }), ['yin', 'yin', 'yang', 'yang']);
assert.deepEqual(mobPlacementSequence({ yang: 2, yin: 2, strategy: 'turn-taking' }), ['yang', 'yin', 'yang', 'yin']);

const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
const yangPlacements = enumerateMobPlacements(square, { yang: 4, yin: 0, limit: 10 });
assert.equal(yangPlacements.placements.length, 10);
assert.equal(yangPlacements.truncated, true);
assert.equal(yangPlacements.placements[0].length, 4);
const yinPlacements = enumerateMobPlacements(square, { yang: 0, yin: 8, limit: 10 });
assert.equal(yinPlacements.placements.length, 10);
assert.equal(yinPlacements.truncated, true);
assert.equal(yinPlacements.placements[0].reduce((total, placement) => total + placement.area, 0), 4);

const record = createCatalogRecord(shapes[1], { profile: { yang: 4, yin: 0, placementCount: 1 } });
assert.equal(record.id, 'P-4-2');
assert.equal(record.profile.placementCount, 1);
console.log('bestiary catalog tests passed');
