import { BESTIARY_VERSION, analyzePolyomino, canonicalPolyomino, createCatalogRecord, enumerateMobPlacements, enumeratePolyominoes, normalizeCells, polyominoGuid } from '../../../packages/bestiary/src/catalog.js';

window.__TDOTDH_BESTIARY__ = Object.freeze({
  version: BESTIARY_VERSION,
  analyzePolyomino,
  canonicalPolyomino,
  createCatalogRecord,
  enumerateMobPlacements,
  enumeratePolyominoes,
  normalizeCells,
  polyominoGuid,
});
window.dispatchEvent(new CustomEvent('tdotdh:bestiary-ready'));
