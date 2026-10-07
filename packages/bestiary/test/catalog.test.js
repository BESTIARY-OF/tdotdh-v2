import assert from 'node:assert/strict';
import { analyzePolyomino, canonicalPolyomino, createCatalogRecord, enumerateMobPlacements, enumeratePolyominoes, mobPlacementSequence, polyominoGuid } from '../src/catalog.js';

const shapes = enumeratePolyominoes(4, { limit: 5 });
assert.equal(shapes.length, 5);
assert.equal(new Set(shapes.map(shape => shape.canonical)).size, 5);
assert.deepEqual(shapes[0].cells, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }]);
assert.equal(analyzePolyomino(shapes[0].cells).perimeter, 10);
assert.equal(canonicalPolyomino([{ x: 1, y: 0 }, { x: 0, y: 0 }]), canonicalPolyomino([{ x: 0, y: 0 }, { x: 0, y: 1 }]));
const originalCatalog = enumeratePolyominoes(9, { limit: 100 });
assert.equal(originalCatalog.length, 100);
assert.equal(originalCatalog[0].ordinal, 1);
assert.equal(originalCatalog.at(-1).ordinal, 100);
assert.equal(enumeratePolyominoes(8, { limit: 1 })[0].ordinal, 1);
assert.equal(originalCatalog[0].familyKey, 'area-9');
assert.equal(originalCatalog[0].legacyAlias, 'area-9#001');
assert.equal(originalCatalog[0].guid, polyominoGuid(originalCatalog[0].canonical));
assert.equal(polyominoGuid([{ x: 1, y: 0 }, { x: 0, y: 0 }]), polyominoGuid([{ x: 0, y: 0 }, { x: 0, y: 1 }]));
const continuation = enumeratePolyominoes(9, { limit: 1, offset: 100 });
assert.equal(continuation[0].ordinal, 101);
assert.notEqual(continuation[0].guid, originalCatalog.at(-1).guid);

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
const impossibleProfile = enumerateMobPlacements(square, { yang: 3, yin: 0, limit: 10 });
assert.deepEqual(impossibleProfile.placements, []);
assert.equal(impossibleProfile.truncated, false);

const record = createCatalogRecord(shapes[1], { profile: { yang: 4, yin: 0, placementCount: 1 } });
assert.equal(record.id, 'P-4-2');
assert.equal(record.guid, polyominoGuid(record.canonical));
assert.equal(record.familyKey, 'area-4');
assert.equal(record.legacyAlias, 'area-4#002');
assert.equal(record.profile.placementCount, 1);
console.log('bestiary catalog tests passed');
