/* Variable-field search worker. Keeping this off the UI thread means a hard
   combinatorial branch can be stopped without freezing or crashing the page. */
const AREA = 9;
const PIECE_COUNT = 15;
const NODE_LIMIT = 40000;
const BEAM_LIMIT = 72;
const BRANCH_LIMIT = 30;

import { createFrontierMaskFromCells } from '../../../packages/search-core/src/webgpu-frontier-validator.js';
import { createFrontierEvaluationCandidate } from '../../../packages/search-core/src/webgpu-frontier-evaluator.js';
import { createFrontierMetricsCandidate } from '../../../packages/search-core/src/webgpu-frontier-metrics.js';
import { createLabeledFrontierStateCandidate } from '../../../packages/search-core/src/webgpu-labeled-frontier-state.js';
import { canonicalSignatureFromLabeledFrontierState } from '../../../packages/search-core/src/webgpu-labeled-frontier-state.js';
import { DEFAULT_FRONTIER_GRID } from '../../../packages/search-core/src/webgpu-frontier-topology.js';

function key(x, y) { return `${x},${y}`; }
function adjacent(p) { return [{ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }]; }
function adjacent8(p) { const result = []; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) result.push({ x: p.x + dx, y: p.y + dy }); return result; }
function shapeSize(cells) { return { width: Math.max(...cells.map(c => c.x)) + 1, height: Math.max(...cells.map(c => c.y)) + 1 }; }
function normalize(cells) { const minX = Math.min(...cells.map(c => c.x)), minY = Math.min(...cells.map(c => c.y)); return cells.map(c => ({ x: c.x - minX, y: c.y - minY })); }
function flip(cells, axis) { const size = shapeSize(cells); return normalize(cells.map(c => axis === 'h' ? { x: size.width - 1 - c.x, y: c.y } : { x: c.x, y: size.height - 1 - c.y })); }
function flipBoth(cells) { const size = shapeSize(cells); return normalize(cells.map(c => ({ x: size.width - 1 - c.x, y: size.height - 1 - c.y }))); }
function rotate(cells, turns) { let result = cells.map(cell => ({ ...cell })); for (let index = 0; index < turns; index++) { const size = shapeSize(result); result = normalize(result.map(c => ({ x: size.height - 1 - c.y, y: c.x }))); } return result; }
function transformCells(cells, transform = 'fixed') { if (transform === 'flip-x') return flip(cells, 'h'); if (transform === 'flip-y') return flip(cells, 'v'); if (transform === 'flip-xy') return flipBoth(cells); if (transform === 'rotate-90') return rotate(cells, 1); if (transform === 'rotate-180') return rotate(cells, 2); if (transform === 'rotate-270') return rotate(cells, 3); return normalize(cells); }
function applyLock(piece) { return transformCells(piece.cells, piece.orientation || 'fixed'); }
function placedCells(piece, origin) { return applyLock(piece).map(c => ({ x: origin.x + c.x, y: origin.y + c.y })); }
function occupiedMap(placements) { const map = new Map(); placements.forEach(p => p.cells.forEach(c => map.set(key(c.x, c.y), p.id))); return map; }
function fieldShapeMetrics(placements, map, outside, minX, maxX, minY, maxY, centroidId) {
  let inletCells = 0, inletEdges = 0;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const cellKey = key(x, y);
    if (map.has(cellKey) || outside.has(cellKey)) continue;
    const landNeighbors = adjacent({ x, y }).filter(next => map.has(key(next.x, next.y))).length;
    if (landNeighbors >= 2) { inletCells++; inletEdges += landNeighbors; }
  }
  const ids = [...new Set(placements.map(placement => placement.id))], graph = new Map(ids.map(id => [id, new Set()]));
  for (const placement of placements) for (const cell of placement.cells) for (const next of adjacent(cell)) { const neighborId = map.get(key(next.x, next.y)); if (neighborId != null && neighborId !== placement.id) { graph.get(placement.id)?.add(neighborId); graph.get(neighborId)?.add(placement.id); } }
  const distances = new Map([[centroidId, 0]]), queue = [centroidId];
  while (queue.length) { const current = queue.shift(), distance = distances.get(current) || 0; for (const next of graph.get(current) || []) if (!distances.has(next)) { distances.set(next, distance + 1); queue.push(next); } }
  const leafDistances = ids.filter(id => id !== centroidId && (graph.get(id)?.size || 0) === 1 && distances.has(id)).map(id => distances.get(id));
  const peninsulaDepth = leafDistances.length ? Math.max(...leafDistances) : 0;
  const nestedPeninsulaDepth = Math.max(0, peninsulaDepth - 1), terminalChains = leafDistances.filter(distance => distance >= 2).length;
  const inletRisk = inletCells + inletEdges * .25 + nestedPeninsulaDepth * 2 + terminalChains * 2;
  return { inletCells, inletEdges, peninsulaDepth, nestedPeninsulaDepth, terminalChains, inletRisk };
}
function fieldMetrics(placements, centroidId = 3) {
  const map = occupiedMap(placements), cells = [...map.keys()].map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; });
  const minX = Math.min(...cells.map(c => c.x)), maxX = Math.max(...cells.map(c => c.x)), minY = Math.min(...cells.map(c => c.y)), maxY = Math.max(...cells.map(c => c.y));
  const outside = new Set([key(minX - 1, minY - 1)]), queue = [{ x: minX - 1, y: minY - 1 }];
  while (queue.length) for (const next of adjacent(queue.shift())) { const k = key(next.x, next.y); if (outside.has(k) || map.has(k) || next.x < minX - 1 || next.x > maxX + 1 || next.y < minY - 1 || next.y > maxY + 1) continue; outside.add(k); queue.push(next); }
  let holes = 0; for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (!map.has(key(x, y)) && !outside.has(key(x, y))) holes++;
  const centroid = cells.filter(c => map.get(key(c.x, c.y)) === centroidId);
  const fieldCenter = { x: cells.reduce((sum, c) => sum + c.x + .5, 0) / cells.length, y: cells.reduce((sum, c) => sum + c.y + .5, 0) / cells.length };
  const centerSquare = [...cells].sort((a, b) => Math.hypot((a.x + .5) - fieldCenter.x, (a.y + .5) - fieldCenter.y) - Math.hypot((b.x + .5) - fieldCenter.x, (b.y + .5) - fieldCenter.y) || a.y - b.y || a.x - b.x)[0];
  const centerSquareDistance = Math.hypot((centerSquare.x + .5) - fieldCenter.x, (centerSquare.y + .5) - fieldCenter.y);
  const centroidPoint = centroid.length ? { x: centroid.reduce((sum, c) => sum + c.x + .5, 0) / centroid.length, y: centroid.reduce((sum, c) => sum + c.y + .5, 0) / centroid.length } : null;
  const centroidSquareOffset = centroidPoint ? Math.hypot(centroidPoint.x - (centerSquare.x + .5), centroidPoint.y - (centerSquare.y + .5)) : Infinity;
  const cellDistances = centroidPoint ? cells.map(c => Math.hypot(c.x + .5 - centroidPoint.x, c.y + .5 - centroidPoint.y)) : [];
  const cellMeanRadius = cellDistances.length ? cellDistances.reduce((sum, value) => sum + value, 0) / cellDistances.length : 0;
  const gravityVariance = cellDistances.length ? Math.sqrt(cellDistances.reduce((sum, value) => sum + (value - cellMeanRadius) ** 2, 0) / cellDistances.length) : Infinity;
  const gravityOffset = centroidPoint ? Math.hypot(cells.reduce((sum, c) => sum + c.x + .5 - centroidPoint.x, 0), cells.reduce((sum, c) => sum + c.y + .5 - centroidPoint.y, 0)) / cells.length : Infinity;
  const gravityTension = gravityVariance + gravityOffset * 2;
  const boundary = []; let perimeter = 0;
  for (const cell of cells) for (const next of adjacent(cell)) if (!map.has(key(next.x, next.y))) { perimeter++; boundary.push({ x: cell.x + (next.x - cell.x) * .5 + .5, y: cell.y + (next.y - cell.y) * .5 + .5 }); }
  const coastDistances = centroidPoint ? boundary.map(c => Math.hypot(c.x - centroidPoint.x, c.y - centroidPoint.y)) : [];
  const coastMean = coastDistances.length ? coastDistances.reduce((sum, value) => sum + value, 0) / coastDistances.length : 0;
  const radialVariance = coastDistances.length ? Math.sqrt(coastDistances.reduce((sum, value) => sum + (value - coastMean) ** 2, 0) / coastDistances.length) : Infinity;
  const centerOffset = centroidPoint ? Math.hypot(centroidPoint.x - fieldCenter.x, centroidPoint.y - fieldCenter.y) : Infinity;
  const width = maxX - minX + 1, height = maxY - minY + 1, density = cells.length / (width * height);
  const centroidEdgeCoast = centroid.some(c => adjacent(c).some(next => !map.has(key(next.x, next.y))));
  const centroidCornerCoast = centroid.some(c => adjacent8(c).some(next => Math.abs(next.x - c.x) === 1 && Math.abs(next.y - c.y) === 1 && !map.has(key(next.x, next.y))));
  const centroidCoast = centroidEdgeCoast || centroidCornerCoast;
  const enclosure = centroidEdgeCoast ? 'open' : centroidCornerCoast ? 'weak' : 'strong';
  const topology = fieldShapeMetrics(placements, map, outside, minX, maxX, minY, maxY, centroidId);
  const centroidSeed = centroidSeedInfo(placements, centroidId);
  const enclosurePenalty = centroidEdgeCoast ? Infinity : centroidCornerCoast ? 100000 : 0;
  const score = perimeter * 1000000 + enclosurePenalty + radialVariance * 1000 + centerOffset * 100 + centroidSquareOffset * 50 + centerSquareDistance * 10 + (1 - density) * 10;
  return { map, cells, minX, maxX, minY, maxY, width, height, holes, centroidCoast, centroidEdgeCoast, centroidCornerCoast, enclosure, centroidFamily: centroidSeed.family, centroidFamilyId: centroidSeed.id, centroidSeed: centroidSeed.seed, centroidNeighborCount: centroidSeed.neighborCount, area: cells.length, perimeter, density, fieldCenter, centerSquare, centerSquareDistance, centroidPoint, centroidSquareOffset, centerOffset, radialVariance, gravityVariance, gravityOffset, gravityTension, score, ...topology };
}
function searchQualityPenalty(metrics, quality = {}) {
  const coastBias = Number(quality.coastBias) || 0, gravityBias = Number(quality.gravityBias) || 0, inletBias = Number(quality.inletBias) || 0;
  return coastBias * metrics.perimeter * 250000 + gravityBias * metrics.gravityTension * 2500 + inletBias * metrics.inletRisk * 500000;
}
function searchQualityScore(metrics, quality = {}) {
  const baseScore = Number.isFinite(metrics.score) ? metrics.score : 0;
  return baseScore + searchQualityPenalty(metrics, quality);
}
function candidateTranslations(piece, field, bounds) {
  const shape = applyLock(piece), frontier = new Set(), translations = new Map();
  for (const cellKey of field) { const [x, y] = cellKey.split(',').map(Number); for (const next of adjacent({ x, y })) if (!field.has(key(next.x, next.y))) frontier.add(key(next.x, next.y)); }
  for (const targetKey of frontier) { const [tx, ty] = targetKey.split(',').map(Number); for (const source of shape) {
    const origin = { x: tx - source.x, y: ty - source.y }, cells = placedCells(piece, origin), keys = cells.map(c => key(c.x, c.y));
    if (keys.some(k => field.has(k)) || translations.has(key(origin.x, origin.y))) continue;
    const nextBounds = { minX: Math.min(bounds.minX, ...cells.map(c => c.x)), maxX: Math.max(bounds.maxX, ...cells.map(c => c.x)), minY: Math.min(bounds.minY, ...cells.map(c => c.y)), maxY: Math.max(bounds.maxY, ...cells.map(c => c.y)) };
    if (nextBounds.maxX - nextBounds.minX + 1 > 24 || nextBounds.maxY - nextBounds.minY + 1 > 16) continue;
    translations.set(key(origin.x, origin.y), { id: piece.id, origin, cells });
  } }
  return [...translations.values()];
}

async function generateFrontierTranslations(piece, state, bounds, frontierGenerator, onGeneration = () => {}, availabilityStatus = null) {
  if (!frontierGenerator?.generate) return candidateTranslations(piece, state.field, bounds);
  if (availabilityStatus && availabilityStatus.status !== 'available') {
    const translations = candidateTranslations(piece, state.field, bounds);
    onGeneration({ status: 'fallback', backend: 'cpu-oracle', parity: 'oracle', candidateCount: translations.length });
    return translations;
  }
  const fieldCells = [...state.field].map(value => { const [x, y] = value.split(',').map(Number); return { x, y }; });
  const result = await frontierGenerator.generate({ fieldCells, pieceCells: applyLock(piece), bounds });
  onGeneration({ status: result?.parity === 'verified' ? 'used' : 'fallback', backend: result?.backend || 'cpu-oracle', parity: result?.parity, compaction: result?.compaction, candidateCount: result?.candidateCount || 0 });
  if (Array.isArray(result?.compactedOrigins)) return result.compactedOrigins.filter(origin => origin && Number.isSafeInteger(origin.x) && Number.isSafeInteger(origin.y)).map(origin => ({ id: piece.id, origin, cells: placedCells(piece, origin) }));
  if (!Array.isArray(result?.origins) || !Array.isArray(result?.validity)) return candidateTranslations(piece, state.field, bounds);
  const translations = new Map();
  result.origins.forEach((origin, index) => {
    if (result.validity[index] !== 1 || !origin || !Number.isSafeInteger(origin.x) || !Number.isSafeInteger(origin.y)) return;
    const cells = placedCells(piece, origin), originKey = `${origin.x},${origin.y}`;
    if (!translations.has(originKey)) translations.set(originKey, { id: piece.id, origin, cells });
  });
  return [...translations.values()];
}
function candidateTranslationsForTarget(piece, field, bounds, target, positionLocks = {}, centroidOrigin = null) {
  const shape = applyLock(piece), translations = new Map(), lock = positionLocks[piece.id], lockedOrigin = lock && centroidOrigin ? { x: centroidOrigin.x + Number(lock.dx), y: centroidOrigin.y + Number(lock.dy) } : null;
  for (const source of shape) {
    const origin = { x: target.x - source.x, y: target.y - source.y }, cells = placedCells(piece, origin), keys = cells.map(c => key(c.x, c.y));
    if (lockedOrigin && (origin.x !== lockedOrigin.x || origin.y !== lockedOrigin.y)) continue;
    if (keys.some(k => field.has(k)) || translations.has(key(origin.x, origin.y))) continue;
    const nextBounds = { minX: Math.min(bounds.minX, ...cells.map(c => c.x)), maxX: Math.max(bounds.maxX, ...cells.map(c => c.x)), minY: Math.min(bounds.minY, ...cells.map(c => c.y)), maxY: Math.max(bounds.maxY, ...cells.map(c => c.y)) };
    if (nextBounds.maxX - nextBounds.minX + 1 > 24 || nextBounds.maxY - nextBounds.minY + 1 > 16) continue;
    translations.set(key(origin.x, origin.y), { id: piece.id, origin, cells });
  }
  return [...translations.values()];
}
function connected(field) {
  const first = field.values().next().value, seen = new Set([first]), queue = [first];
  while (queue.length) { const [x, y] = queue.shift().split(',').map(Number); for (const next of adjacent({ x, y })) { const k = key(next.x, next.y); if (field.has(k) && !seen.has(k)) { seen.add(k); queue.push(k); } } }
  return seen.size === field.size;
}
function centroidSeedInfo(placements, centroidId = 3) {
  const centroidPlacement = placements.find(p => p.id === centroidId), centroid = centroidPlacement?.cells || [], minX = centroid.length ? Math.min(...centroid.map(c => c.x)) : 0, minY = centroid.length ? Math.min(...centroid.map(c => c.y)) : 0, touching = new Map();
  for (const placement of placements) {
    if (placement.id === centroidId) continue;
    const contacts = [];
    for (const cell of placement.cells) for (const center of centroid) if (Math.abs(cell.x - center.x) + Math.abs(cell.y - center.y) === 1) contacts.push(`${center.x - minX},${center.y - minY}>${cell.x - center.x},${cell.y - center.y}`);
    if (contacts.length) touching.set(placement.id, [...new Set(contacts)].sort());
  }
  const ids = [...touching.keys()].sort((a, b) => a - b);
  const seed = ids.map(id => `#${String(id).padStart(2, '0')}[${touching.get(id).join(';')}]`).join('|') || 'none';
  return { family: ids.length ? ids.map(id => `#${String(id).padStart(2, '0')}`).join(' + ') : 'none', seed, id: seedFamilyId(seed), neighborCount: ids.length };
}
function seedFamilyId(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) { hash ^= seed.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `F-${(hash >>> 0).toString(36).toUpperCase().padStart(7, '0')}`;
}
function arrangementSignature(placements) {
  const cells = placements.flatMap(placement => placement.cells), minX = Math.min(...cells.map(cell => cell.x)), minY = Math.min(...cells.map(cell => cell.y));
  return [...placements].sort((a, b) => a.id - b.id).map(placement => `${placement.id}:${placement.cells.map(cell => `${cell.x - minX},${cell.y - minY}`).sort().join(';')}`).join('|');
}
function seededRandom(seed = '') {
  let state = 2166136261;
  for (const character of String(seed)) { state ^= character.charCodeAt(0); state = Math.imul(state, 16777619); }
  return () => { state = Math.imul(state ^ (state >>> 13), 1274126177); state ^= state >>> 16; return (state >>> 0) / 4294967296; };
}
function pieceDirections(placements, id, centroidId = 3) {
  const piece = placements.find(placement => placement.id === id), centroid = placements.find(placement => placement.id === centroidId);
  if (!piece || !centroid) return [];
  const bounds = cells => ({ minX: Math.min(...cells.map(cell => cell.x)), maxX: Math.max(...cells.map(cell => cell.x)), minY: Math.min(...cells.map(cell => cell.y)), maxY: Math.max(...cells.map(cell => cell.y)) });
  const center = cells => ({ x: cells.reduce((sum, cell) => sum + cell.x + .5, 0) / cells.length, y: cells.reduce((sum, cell) => sum + cell.y + .5, 0) / cells.length });
  const pieceBounds = bounds(piece.cells), centroidBounds = bounds(centroid.cells), pieceCenter = center(piece.cells), centroidCenter = center(centroid.cells), candidates = [];
  if (pieceBounds.minX < centroidBounds.minX) candidates.push({ direction: 'west', dominance: Math.abs(pieceCenter.x - centroidCenter.x), gap: centroidBounds.minX - pieceBounds.minX });
  if (pieceBounds.maxX > centroidBounds.maxX) candidates.push({ direction: 'east', dominance: Math.abs(pieceCenter.x - centroidCenter.x), gap: pieceBounds.maxX - centroidBounds.maxX });
  if (pieceBounds.minY < centroidBounds.minY) candidates.push({ direction: 'north', dominance: Math.abs(pieceCenter.y - centroidCenter.y), gap: centroidBounds.minY - pieceBounds.minY });
  if (pieceBounds.maxY > centroidBounds.maxY) candidates.push({ direction: 'south', dominance: Math.abs(pieceCenter.y - centroidCenter.y), gap: pieceBounds.maxY - centroidBounds.maxY });
  candidates.sort((a, b) => b.dominance - a.dominance || b.gap - a.gap);
  return candidates.length ? [candidates[0].direction] : [];
}
function targetSeedCompatible(seed, targetSeed) {
  if (!targetSeed || seed === 'none') return false;
  return seed.split('|').every(part => targetSeed.includes(part));
}
function targetSeedProgress(seed, targetSeed) {
  if (!targetSeed || seed === 'none') return 0;
  const targetParts = new Set(targetSeed.split('|'));
  return seed.split('|').filter(part => targetParts.has(part)).length;
}
function compareResultRanks(a, b) {
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}
function lockedSeedBranches(pieces, centroidId, seedPlacement, seedOrigin, seedSet, centroidRing, positionLocks) {
  const lockedIds = Object.keys(positionLocks).map(Number).filter(id => id !== centroidId && pieces.some(piece => piece.id === id));
  if (!lockedIds.length) return [];
  const placements = [seedPlacement], field = new Set(seedSet);
  for (const id of lockedIds) {
    const piece = pieces.find(item => item.id === id), lock = positionLocks[id], origin = { x: seedOrigin.x + Number(lock.dx), y: seedOrigin.y + Number(lock.dy) }, cells = placedCells(piece, origin), keys = cells.map(cell => key(cell.x, cell.y));
    if (keys.some(cellKey => field.has(cellKey))) return [];
    placements.push({ id, origin, cells });
    keys.forEach(cellKey => field.add(cellKey));
  }
  const lockedMetrics = fieldMetrics(placements, centroidId);
  if (!lockedMetrics || lockedMetrics.holes > 0 || !connected(field)) return [];
  const allDirect = placements.slice(1).every(placement => placement.cells.some(cell => adjacent(cell).some(next => seedSet.has(key(next.x, next.y)))));
  if (!allDirect) return [];
  const remaining = pieces.filter(piece => piece.id !== centroidId && !lockedIds.includes(piece.id)), openTargets = [...centroidRing].filter(ringKey => !field.has(ringKey)).map(ringKey => ringKey.split(',').map(Number)).map(([x, y]) => ({ x, y })), branches = [], seenFamilies = new Set();
  for (const target of openTargets) for (const piece of remaining) for (const candidate of candidateTranslationsForTarget(piece, field, lockedMetrics, target, {}, seedOrigin)) {
    const candidatePlacements = [...placements, candidate], metrics = fieldMetrics(candidatePlacements, centroidId);
    if (!metrics || metrics.holes > 0 || metrics.centroidNeighborCount !== lockedIds.length + 1 || seenFamilies.has(metrics.centroidFamilyId)) continue;
    seenFamilies.add(metrics.centroidFamilyId);
    const nextField = new Set(field); candidate.cells.forEach(cell => nextField.add(key(cell.x, cell.y)));
    branches.push({ placements: candidatePlacements, field: nextField, remaining: remaining.filter(item => item.id !== piece.id), bounds: metrics, score: metrics.score, hintMatches: 0, centroidFamily: metrics.centroidFamily, centroidFamilyId: metrics.centroidFamilyId, centroidSeed: metrics.centroidSeed });
  }
  return branches;
}
function targetSeedBranches(pieces, centroidId, seedPlacement, seedOrigin, seedSet, targetSeed, positionLocks, random = Math.random) {
  if (!targetSeed || targetSeed === 'none') return [];
  const targets = targetSeed.split('|').map(part => {
    const match = part.match(/^#(\d+)\[(.*)\]$/);
    if (!match) return null;
    const contacts = match[2].split(';').filter(Boolean).map(contact => {
      const [relative, direction] = contact.split('>'), [x, y] = relative.split(',').map(Number), [dx, dy] = direction.split(',').map(Number);
      return { relative: `${x},${y}>${dx},${dy}`, x: seedOrigin.x + x + dx, y: seedOrigin.y + y + dy };
    });
    return { id: Number(match[1]), part, contacts };
  }).filter(target => target && target.contacts.length);
  if (!targets.length) return [];
  let states = [{ placements: [seedPlacement], field: new Set(seedSet) }];
  for (const target of targets) {
    const piece = pieces.find(item => item.id === target.id);
    if (!piece) return [];
    const nextStates = [], lock = positionLocks[piece.id], lockedOrigin = lock ? { x: seedOrigin.x + Number(lock.dx), y: seedOrigin.y + Number(lock.dy) } : null;
    for (const state of states) {
      const bounds = fieldMetrics(state.placements, centroidId);
      for (const contact of target.contacts) for (const source of applyLock(piece)) {
        const origin = { x: contact.x - source.x, y: contact.y - source.y };
        if (lockedOrigin && (origin.x !== lockedOrigin.x || origin.y !== lockedOrigin.y)) continue;
        const cells = placedCells(piece, origin), keys = cells.map(cell => key(cell.x, cell.y));
        if (keys.some(cellKey => state.field.has(cellKey))) continue;
        const placement = { id: piece.id, origin, cells }, metrics = fieldMetrics([...state.placements, placement], centroidId), actualPart = metrics.centroidSeed.split('|').find(part => part.startsWith(`#${String(piece.id).padStart(2, '0')}[`));
        if (actualPart !== target.part || metrics.holes > 0) continue;
        const field = new Set(state.field); keys.forEach(cellKey => field.add(cellKey));
        const signature = [...field].sort().join('|');
        if (!nextStates.some(candidate => candidate.signature === signature)) nextStates.push({ placements: [...state.placements, placement], field, signature, bounds: metrics });
      }
    }
    states = nextStates.sort(() => random() - .5);
    if (!states.length) return [];
  }
  return states.map(state => {
    const metrics = fieldMetrics(state.placements, centroidId);
    return { placements: state.placements, field: state.field, remaining: pieces.filter(piece => piece.id !== centroidId && !targets.some(target => target.id === piece.id)), bounds: metrics, score: metrics.score, hintMatches: 0, centroidFamily: metrics.centroidFamily, centroidFamilyId: metrics.centroidFamilyId, centroidSeed: metrics.centroidSeed };
  }).filter(branch => branch.centroidSeed === targetSeed && branch.bounds.holes === 0 && connected(branch.field));
}
function completedResult(placements, metrics, nodes) {
  return { type: 'done', placements, metrics: { width: metrics.width, height: metrics.height, area: metrics.area, holes: metrics.holes, centroidCoast: metrics.centroidCoast, centroidEdgeCoast: metrics.centroidEdgeCoast, centroidCornerCoast: metrics.centroidCornerCoast, enclosure: metrics.enclosure, centroidFamily: metrics.centroidFamily, centroidFamilyId: metrics.centroidFamilyId, centroidSeed: metrics.centroidSeed, centroidNeighborCount: metrics.centroidNeighborCount, perimeter: metrics.perimeter, density: metrics.density, centerOffset: metrics.centerOffset, centroidSquareOffset: metrics.centroidSquareOffset, centerSquareDistance: metrics.centerSquareDistance, radialVariance: metrics.radialVariance, gravityVariance: metrics.gravityVariance, gravityOffset: metrics.gravityOffset, gravityTension: metrics.gravityTension, inletCells: metrics.inletCells, inletEdges: metrics.inletEdges, inletRisk: metrics.inletRisk, peninsulaDepth: metrics.peninsulaDepth, nestedPeninsulaDepth: metrics.nestedPeninsulaDepth, terminalChains: metrics.terminalChains, score: metrics.score }, nodes };
}
function frontierScoreTerms(metrics) {
  const score = Number.isFinite(metrics?.score) ? Math.max(-0x80000000, Math.min(0x7fffffff, Math.trunc(metrics.score))) : 0x7fffffff;
  return [score, 0, 0, 0, 0, 0, 0, 0];
}

async function evaluateFrontierGeometry(entries, state, centroidId, frontierMetrics, onMetrics = () => {}) {
  if (!frontierMetrics?.evaluate || !entries.length) return entries;
  try {
    const parentCells = [...state.field].map(value => { const [x, y] = value.split(',').map(Number); return { x, y }; });
    const centroidCells = state.placements.find(placement => placement.id === centroidId)?.cells || [];
    const centroidRing = new Map();
    for (const cell of centroidCells) for (const next of adjacent(cell)) if (!centroidCells.some(other => other.x === next.x && other.y === next.y)) centroidRing.set(key(next.x, next.y), next);
    const candidates = entries.map(entry => createFrontierMetricsCandidate({ parentCells, candidateCells: entry.candidate.cells, centroidCells, ringCells: [...centroidRing.values()], bounds: state.bounds }));
    const result = await frontierMetrics.evaluate(candidates);
    if (result?.status === 'completed' && result.parity === 'verified' && Array.isArray(result.metrics) && result.metrics.length === entries.length) {
      onMetrics({ status: 'used', backend: result.backend || 'compute-shader', parity: result.parity, candidateCount: entries.length });
      return entries.map((entry, index) => ({ ...entry, gpuGeometry: result.metrics[index] }));
    }
    onMetrics({ status: 'fallback', reason: result?.reason || 'frontier-metrics-unavailable' });
  } catch (error) { onMetrics({ status: 'fallback', reason: `frontier-metrics-failed:${error.message}` }); }
  return entries;
}

async function evaluateFrontierState(entries, state, frontierState, onState = () => {}) {
  if (!frontierState?.transition || !entries.length) return entries;
  try {
    const pieceIds = [...new Set([...state.placements.map(placement => placement.id), ...state.remaining.map(piece => piece.id)])].sort((a, b) => a - b);
    const candidates = entries.map(entry => createLabeledFrontierStateCandidate({
      parentPlacements: state.placements,
      candidate: { id: entry.piece.id, cells: entry.candidate.cells },
      pieceIds,
      remainingIds: state.remaining.filter(piece => piece.id !== entry.piece.id).map(piece => piece.id),
    }));
    const result = await frontierState.transition(candidates);
    if (result?.status === 'completed' && result.parity === 'verified' && Array.isArray(result.absoluteHashes) && result.absoluteHashes.length === entries.length) {
      onState({ status: 'used', backend: result.backend || 'compute-shader', parity: result.parity, candidateCount: entries.length });
      const wordCount = Number(result.wordCount) || 0;
      const labelsPerCandidate = result.pieceIds.length * wordCount;
      return entries.map((entry, index) => {
        const labelStart = index * labelsPerCandidate;
        const nextLabels = result.nextLabels.slice(labelStart, labelStart + labelsPerCandidate);
        const canonicalLabels = result.canonicalLabels.slice(labelStart, labelStart + labelsPerCandidate);
        const remainingMask = Array.from(candidates[index].remainingMask);
        return { ...entry, gpuState: { absoluteHash: result.absoluteHashes[index], canonicalHash: result.canonicalHashes[index], nextLabels, canonicalLabels, pieceIds: result.pieceIds, wordCount, remainingMask, stateKey: `${result.pieceIds.join(',')}:${remainingMask.join(',')}:${nextLabels.join(',')}` } };
      });
    }
    onState({ status: 'fallback', reason: result?.reason || 'frontier-state-unavailable' });
  } catch (error) { onState({ status: 'fallback', reason: `frontier-state-failed:${error.message}` }); }
  return entries;
}

async function evaluateFrontierTopology(entries, state, centroidId, frontierTopology, onTopology = () => {}) {
  if (!frontierTopology?.evaluateBatch && !frontierTopology?.evaluate) return entries;
  try {
    const parentCells = [...state.field].map(value => { const [x, y] = value.split(',').map(Number); return { x, y }; });
    const centroidCells = state.placements.find(placement => placement.id === centroidId)?.cells || [];
    const inputs = entries.map(entry => ({ parentMask: createFrontierMaskFromCells(parentCells), candidateMask: createFrontierMaskFromCells(entry.candidate.cells), centroidMask: createFrontierMaskFromCells(centroidCells) }));
    const result = frontierTopology.evaluateBatch ? await frontierTopology.evaluateBatch(inputs) : { status: 'completed', parity: 'verified', backend: 'compute-shader', results: await Promise.all(inputs.map(input => frontierTopology.evaluate(input))) };
    if (result?.status === 'completed' && result.parity === 'verified' && Array.isArray(result.results) && result.results.length === entries.length) {
      onTopology({ status: 'used', backend: result.backend || 'compute-shader', parity: result.parity, candidateCount: entries.length });
      return entries.map((entry, index) => ({ ...entry, gpuTopology: result.results[index]?.metrics || null }));
    }
    onTopology({ status: 'fallback', reason: result?.reason || 'frontier-topology-batch-unavailable' });
  } catch (error) { onTopology({ status: 'fallback', reason: `frontier-topology-batch-failed:${error.message}` }); }
  return entries;
}

async function evaluateFrontierOptions(entries, state, centroidId, frontierEvaluator, frontierValidator, onFrontier = () => {}) {
  if (!entries.length) return entries;
  try {
    const parentCells = [...state.field].map(value => { const [x, y] = value.split(',').map(Number); return { x, y }; });
    if (frontierEvaluator?.evaluate) {
      const candidates = entries.map(entry => createFrontierEvaluationCandidate({ parentCells, candidateCells: entry.candidate.cells, scoreTerms: frontierScoreTerms(entry.metrics || fieldMetrics([...state.placements, entry.candidate], centroidId)) }));
      const result = await frontierEvaluator.evaluate(candidates);
      if (Array.isArray(result?.validity) && result.validity.length === entries.length && result.status === 'completed') {
        onFrontier({ status: result.parity === 'verified' ? 'used' : 'fallback', backend: result.backend || 'cpu-oracle', parity: result.parity, candidateCount: entries.length });
        return entries.filter((entry, index) => result.validity[index] === 1).map((entry, index) => ({ ...entry, gpuScore: result.scores?.[index] }));
      }
      onFrontier({ status: 'fallback', reason: result?.reason || 'frontier-evaluator-unavailable' });
    }
    if (!frontierValidator?.validate) return entries;
    const candidates = entries.map(entry => ({ parentMask: createFrontierMaskFromCells(parentCells), candidateMask: createFrontierMaskFromCells(entry.candidate.cells) }));
    const result = await frontierValidator.validate(candidates);
    if (result?.status === 'completed' && Array.isArray(result.validity) && result.validity.length === entries.length) {
      onFrontier({ status: 'used', backend: result.backend || 'compute-shader', candidateCount: entries.length });
      return entries.filter((entry, index) => result.validity[index] === 1);
    }
    onFrontier({ status: 'fallback', reason: result?.reason || 'frontier-validator-unavailable' });
  } catch (error) {
    onFrontier({ status: 'fallback', reason: `frontier-validator-failed:${error.message}` });
  }
  return entries;
}

async function evaluateFinalTopology(state, centroidId, frontierTopology, onTopology = () => {}) {
  if (!frontierTopology?.evaluate) return null;
  try {
    const cells = state.placements.flatMap(placement => placement.cells);
    const centroidCells = state.placements.find(placement => placement.id === centroidId)?.cells || [];
    const emptyMask = new Uint32Array(Math.ceil(DEFAULT_FRONTIER_GRID.width * DEFAULT_FRONTIER_GRID.height / 32));
    const result = await frontierTopology.evaluate({ parentMask: emptyMask, candidateMask: createFrontierMaskFromCells(cells), centroidMask: centroidCells.length ? createFrontierMaskFromCells(centroidCells) : emptyMask });
    if (result?.status === 'completed' && ['verified', 'labels-verified'].includes(result.parity) && result.metrics) {
      onTopology({ status: 'used', backend: result.backend || 'compute-shader', parity: result.parity, metrics: result.metrics });
      return result.metrics;
    }
    onTopology({ status: result?.status === 'rejected' ? 'rejected' : 'fallback', reason: result?.reason || 'frontier-topology-unavailable' });
  } catch (error) { onTopology({ status: 'fallback', reason: `frontier-topology-failed:${error.message}` }); }
  return null;
}

async function searchLockedSeedBranches(pieces, branches, knownFamilies, centroidId, targetNeighborCount, allowKnownFamily = false, knownSignatures = new Set(), searchHints = false, positionPreferences = {}, random = Math.random, quality = {}, candidatePrefilter = null, onPrefilter = () => {}, frontierValidator = null, frontierEvaluator = null, frontierGenerator = null, frontierGeneratorStatus = null, onFrontier = () => {}, onGeneration = () => {}, isCancelled = () => {}, frontierMetrics = null, onMetrics = () => {}, frontierState = null, onState = () => {}, frontierTopology = null, onTopology = () => {}) {
  const unknownBranches = (allowKnownFamily ? branches : branches.filter(branch => !knownFamilies.has(branch.centroidFamilyId))).sort(() => random() - .5);
  let nodes = 0;
  for (const branch of unknownBranches) {
    const branchBudget = Math.max(1, Math.floor(NODE_LIMIT / Math.max(1, unknownBranches.length))), branchStart = nodes;
    async function complete(state) {
      if (isCancelled()) return null;
      if (nodes - branchStart >= branchBudget) return null;
      nodes++;
      if (!state.remaining.length) {
        const metrics = fieldMetrics(state.placements, centroidId);
        const topologyMetrics = await evaluateFinalTopology(state, centroidId, frontierTopology, onTopology);
        const acceptedMetrics = { ...metrics, ...(topologyMetrics || {}), connected: topologyMetrics?.connected ?? connected(state.field) };
        if (acceptedMetrics.area === pieces.length * AREA && acceptedMetrics.holes === 0 && !acceptedMetrics.centroidEdgeCoast && acceptedMetrics.connected && (targetNeighborCount == null || metrics.centroidNeighborCount === targetNeighborCount) && !knownSignatures.has(arrangementSignature(state.placements))) return completedResult(state.placements, metrics, nodes);
        return null;
      }
      const choices = [];
      for (const piece of state.remaining) {
        let options = (await generateFrontierTranslations(piece, state, state.bounds, frontierGenerator, onGeneration, frontierGeneratorStatus)).map(candidate => {
          const placements = [...state.placements, candidate], metrics = fieldMetrics(placements, centroidId);
          const hint = searchHints && positionPreferences[piece.id] ? pieceDirections(placements, piece.id, centroidId).includes(positionPreferences[piece.id]) : false;
          return metrics.holes === 0 ? { candidate, metrics, hintMatches: (state.hintMatches || 0) + (hint ? 1 : 0) } : null;
        }).filter(Boolean);
        if (candidatePrefilter?.prefilter && options.length) {
          const result = await candidatePrefilter.prefilter(options.map(option => [option.candidate]));
          if (result?.status === 'completed' && Array.isArray(result.validity) && result.validity.length === options.length) {
            onPrefilter({ status: 'used', backend: result.backend || 'compute-shader', candidateCount: options.length });
            options = options.filter((option, index) => result.validity[index] === 1);
          } else {
            onPrefilter({ status: 'fallback', reason: result?.reason || 'prefilter-unavailable' });
          }
        }
        options = await evaluateFrontierGeometry(options, state, centroidId, frontierMetrics, onMetrics);
        options = await evaluateFrontierState(options, state, frontierState, onState);
        options = await evaluateFrontierOptions(options, state, centroidId, frontierEvaluator, frontierValidator, onFrontier);
        if (!options.length) return null;
        choices.push({ piece, options });
      }
      choices.sort((a, b) => a.options.length - b.options.length);
      const choice = choices[0];
      choice.options.sort((a, b) => b.hintMatches - a.hintMatches || b.metrics.density - a.metrics.density || searchQualityScore(a.metrics, quality) - searchQualityScore(b.metrics, quality) || random() - .5);
      for (const option of choice.options) {
        if (isCancelled()) return null;
        const placements = [...state.placements, option.candidate], field = new Set(state.field); option.candidate.cells.forEach(cell => field.add(key(cell.x, cell.y)));
        const result = await complete({ placements, field, remaining: state.remaining.filter(piece => piece.id !== choice.piece.id), bounds: option.metrics, hintMatches: option.hintMatches });
        if (result) return result;
        if (nodes - branchStart >= branchBudget) return null;
      }
      return null;
    }
    const result = await complete(branch);
    if (result) return result;
  }
  return { type: 'done', placements: null, metrics: null, nodes };
}

async function search(pieces, knownCentroidFamilies = [], options = {}) {
  const knownFamilies = new Set(knownCentroidFamilies);
  const candidatePrefilter = options.candidatePrefilter;
  const frontierEvaluator = options.frontierEvaluator;
  const frontierGenerator = options.frontierGenerator;
  const frontierMetrics = options.frontierMetrics;
  const frontierState = options.frontierState;
  const frontierTopology = options.frontierTopology;
  const frontierGeneratorStatus = frontierGenerator?.availability ? await frontierGenerator.availability() : null;
  let prefilterReceipt = { status: 'cpu-oracle' }, frontierReceipt = { status: 'cpu-oracle' }, frontierGenerationReceipt = { status: 'cpu-oracle' }, frontierMetricsReceipt = { status: 'cpu-oracle' }, frontierStateReceipt = { status: 'cpu-oracle' }, frontierTopologyReceipt = { status: 'cpu-oracle' };
  async function filterCandidates(entries) {
    if (!candidatePrefilter?.prefilter || entries.length === 0) return entries;
    const result = await candidatePrefilter.prefilter(entries.map(entry => [entry.candidate]));
    if (result?.status === 'completed' && Array.isArray(result.validity) && result.validity.length === entries.length) {
      prefilterReceipt = { status: 'used', backend: result.backend || 'compute-shader', candidateCount: entries.length };
      return entries.filter((entry, index) => result.validity[index] === 1);
    }
    if (prefilterReceipt.status === 'cpu-oracle') prefilterReceipt = { status: 'fallback', reason: result?.reason || 'prefilter-unavailable' };
    return entries;
  }
  const searchHints = Boolean(options.searchHints);
  const searchStrategy = options.searchStrategy || 'balanced';
  const targetFamily = options.targetFamily || null;
  const targetSeed = options.targetSeed || null;
  const targetNeighborCount = options.targetNeighborCount == null || options.targetNeighborCount === '' ? null : (Number.isFinite(Number(options.targetNeighborCount)) ? Number(options.targetNeighborCount) : null);
  const quality = { coastBias: options.coastBias, gravityBias: options.gravityBias, inletBias: options.inletBias };
  const positionPreferences = options.positionPreferences || {};
  const positionLocks = options.positionLocks || {};
  const knownSignatures = new Set(options.knownSignatures || []);
  const isCancelled = typeof options.isCancelled === 'function' ? options.isCancelled : () => false;
  const reportProgress = typeof options.reportProgress === 'function'
    ? options.reportProgress
    : progress => postMessage({ type: 'progress', ...progress });
  const random = seededRandom(options.searchSalt || `${targetFamily || 'open'}:${options.rootChoice || 0}`);
  const preferNewFamily = searchStrategy === 'breadth' && !targetFamily;
  const centroidId = Number(options.centroidId || 3), centroidPiece = pieces.find(p => p.id === centroidId), centerShape = applyLock(centroidPiece), centerSize = shapeSize(centerShape), seedOrigin = { x: -Math.floor(centerSize.width / 2), y: -Math.floor(centerSize.height / 2) }, seedCells = placedCells(centroidPiece, seedOrigin), seedPlacement = { id: centroidId, origin: seedOrigin, cells: seedCells };
  const seedSet = new Set(seedCells.map(c => key(c.x, c.y))), centroidRing = new Set(); seedCells.forEach(cell => adjacent(cell).forEach(next => { if (!seedSet.has(key(next.x, next.y))) centroidRing.add(key(next.x, next.y)); }));
  const seed = { placements: [seedPlacement], field: new Set(seedCells.map(c => key(c.x, c.y))), remaining: pieces.filter(p => p.id !== centroidId), bounds: fieldMetrics([seedPlacement], centroidId), hintMatches: 0 }, seedBranches = searchStrategy === 'breadth' ? lockedSeedBranches(pieces, centroidId, seedPlacement, seedOrigin, seedSet, centroidRing, positionLocks) : targetFamily ? targetSeedBranches(pieces, centroidId, seedPlacement, seedOrigin, seedSet, targetSeed, positionLocks, random) : [];
  if (seedBranches.length) {
    const lockedResult = await searchLockedSeedBranches(pieces, seedBranches, knownFamilies, centroidId, targetNeighborCount, Boolean(targetFamily), knownSignatures, searchHints, positionPreferences, random, quality, candidatePrefilter, receipt => { prefilterReceipt = receipt; }, options.frontierValidator, frontierEvaluator, frontierGenerator, frontierGeneratorStatus, receipt => { frontierReceipt = receipt; }, receipt => { frontierGenerationReceipt = receipt; }, isCancelled, options.frontierMetrics, receipt => { frontierMetricsReceipt = receipt; }, options.frontierState, receipt => { frontierStateReceipt = receipt; }, frontierTopology, receipt => { frontierTopologyReceipt = receipt; });
    return { ...lockedResult, prefilter: prefilterReceipt, frontier: frontierReceipt, frontierGeneration: frontierGenerationReceipt, frontierMetrics: frontierMetricsReceipt, frontierState: frontierStateReceipt, frontierTopology: frontierTopologyReceipt };
  }
  const beam = [seed];
  let nodes = 0, fallback = null, bestHintResult = null;
  const pieceCount = pieces.length;
  for (let depth = 0; depth < pieceCount - 1 && beam.length && nodes < NODE_LIMIT; depth++) {
    if (isCancelled()) return { type: 'done', placements: null, metrics: null, nodes, prefilter: prefilterReceipt, frontier: frontierReceipt, frontierGeneration: frontierGenerationReceipt, frontierMetrics: frontierMetricsReceipt, frontierState: frontierStateReceipt, frontierTopology: frontierTopologyReceipt };
    const nextBeam = [];
    const stateKeys = new Set();
    for (const state of beam) {
      if (isCancelled()) return { type: 'done', placements: null, metrics: null, nodes, prefilter: prefilterReceipt, frontier: frontierReceipt, frontierGeneration: frontierGenerationReceipt, frontierMetrics: frontierMetricsReceipt, frontierState: frontierStateReceipt, frontierTopology: frontierTopologyReceipt };
      if (nodes >= NODE_LIMIT) break;
      let selectedTarget = null, selectedOptions = null;
      const openCentroid = [...centroidRing].filter(ringKey => !state.field.has(ringKey));
      const frontier = new Map();
      for (const cellKey of state.field) {
        const [x, y] = cellKey.split(',').map(Number);
        for (const next of adjacent({ x, y })) if (!state.field.has(key(next.x, next.y))) frontier.set(key(next.x, next.y), next);
      }
      const ringTargets = openCentroid.map(ringKey => frontier.get(ringKey)).filter(Boolean), targetPool = ringTargets.length ? ringTargets : [...frontier.values()];
      const useGeneratedFrontier = frontierGeneratorStatus?.status === 'available';
      const generatedByPiece = useGeneratedFrontier ? new Map() : null;
      if (useGeneratedFrontier) for (const piece of state.remaining) generatedByPiece.set(piece.id, await generateFrontierTranslations(piece, state, state.bounds, frontierGenerator, receipt => { frontierGenerationReceipt = receipt; }, frontierGeneratorStatus));
      else if (frontierGenerator?.generate && frontierGenerationReceipt.status === 'cpu-oracle') frontierGenerationReceipt = { status: 'fallback', backend: 'cpu-oracle', parity: 'oracle', candidateCount: 0 };
      for (const target of targetPool) {
        const options = [];
        for (const piece of state.remaining) {
          const generated = useGeneratedFrontier ? (generatedByPiece.get(piece.id) || []) : candidateTranslationsForTarget(piece, state.field, state.bounds, target, positionLocks, seedOrigin);
          if (!useGeneratedFrontier) { for (const candidate of generated) options.push({ piece, candidate }); continue; }
          const targetCandidates = new Set(candidateTranslationsForTarget(piece, state.field, state.bounds, target, positionLocks, seedOrigin).map(candidate => `${candidate.origin.x},${candidate.origin.y}`));
          for (const candidate of generated) if (targetCandidates.has(`${candidate.origin.x},${candidate.origin.y}`)) options.push({ piece, candidate });
        }
        if (options.length && (!selectedOptions || options.length < selectedOptions.length)) { selectedTarget = target; selectedOptions = options; }
      }
      if (!selectedTarget) continue;
      selectedOptions = await filterCandidates(selectedOptions);
      selectedOptions = await evaluateFrontierGeometry(selectedOptions, state, centroidId, frontierMetrics, receipt => { frontierMetricsReceipt = receipt; });
      selectedOptions = await evaluateFrontierOptions(selectedOptions, state, centroidId, frontierEvaluator, options.frontierValidator, receipt => { frontierReceipt = receipt; });
      selectedOptions = await evaluateFrontierState(selectedOptions, state, frontierState, receipt => { frontierStateReceipt = receipt; });
      selectedOptions = await evaluateFrontierTopology(selectedOptions, state, centroidId, frontierTopology, receipt => { frontierTopologyReceipt = receipt; });
      if (!selectedOptions.length) continue;
      const ranked = selectedOptions.map(({ piece, candidate, gpuGeometry, gpuState, gpuTopology }) => {
        const nextBounds = { minX: Math.min(state.bounds.minX, ...candidate.cells.map(c => c.x)), maxX: Math.max(state.bounds.maxX, ...candidate.cells.map(c => c.x)), minY: Math.min(state.bounds.minY, ...candidate.cells.map(c => c.y)), maxY: Math.max(state.bounds.maxY, ...candidate.cells.map(c => c.y)) };
        const contact = candidate.cells.reduce((n, c) => n + adjacent(c).filter(a => state.field.has(key(a.x, a.y))).length, 0), centroidContact = candidate.cells.reduce((n, c) => n + adjacent8(c).filter(a => seedSet.has(key(a.x, a.y))).length, 0), ringCoverage = candidate.cells.reduce((n, c) => n + (centroidRing.has(key(c.x, c.y)) ? 1 : 0), 0), openCentroid = [...centroidRing].filter(ringKey => !state.field.has(ringKey) && !candidate.cells.some(c => key(c.x, c.y) === ringKey)).length;
        nodes++;
        const candidatePlacements = [...state.placements, candidate], candidateMetrics = fieldMetrics(candidatePlacements, centroidId), candidateFamilyTarget = candidateMetrics.centroidSeed === 'none' || targetSeedCompatible(candidateMetrics.centroidSeed, targetSeed);
        if (targetFamily && !candidateFamilyTarget) return null;
        const targetProgress = targetFamily ? targetSeedProgress(candidateMetrics.centroidSeed, targetSeed) : 0, familyIsNew = !knownFamilies.has(candidateMetrics.centroidFamilyId), hint = searchHints && positionPreferences[piece.id] ? pieceDirections(candidatePlacements, piece.id, centroidId).includes(positionPreferences[piece.id]) : false, hintMatches = (state.hintMatches || 0) + (hint ? 1 : 0);
        const targetBonus = targetFamily ? -320 * targetProgress : 0;
        const hintBonus = hint ? -220 : 0;
        const noveltyBonus = searchStrategy === 'breadth' && !targetFamily && familyIsNew ? -220 : 0;
        const neighborTargetBonus = targetNeighborCount == null ? 0 : (candidateMetrics.centroidNeighborCount === targetNeighborCount ? -600 : Math.abs(candidateMetrics.centroidNeighborCount - targetNeighborCount) * 80);
        const qualityPenalty = searchQualityPenalty(candidateMetrics, quality) / 100000;
        const gpuGeometryScore = Number.isFinite(gpuGeometry?.[5]) ? gpuGeometry[5] / 1000 : null;
      const gpuEvaluatorScore = Number.isFinite(candidate.gpuScore) ? candidate.gpuScore / 1000000 : null;
      const gpuTopologyScore = Number.isFinite(gpuTopology?.perimeter) ? gpuTopology.perimeter / 1000 : null;
      const geometryScore = gpuGeometryScore ?? gpuEvaluatorScore ?? gpuTopologyScore ?? (openCentroid * 40 + (nextBounds.maxX - nextBounds.minX + 1) * (nextBounds.maxY - nextBounds.minY + 1) - contact * 2.4 - centroidContact * 2 - ringCoverage * 8);
        return { piece, candidate, gpuState, score: geometryScore + targetBonus + noveltyBonus + neighborTargetBonus + hintBonus + qualityPenalty + random() * 12, nextBounds, hintMatches };
      }).filter(Boolean).sort((a, b) => a.score - b.score).slice(0, BRANCH_LIMIT);
      for (const option of ranked) {
        const placements = [...state.placements, option.candidate], metrics = fieldMetrics(placements, centroidId), field = new Set(state.field); option.candidate.cells.forEach(c => field.add(key(c.x, c.y)));
        if (metrics.holes > 0) continue;
        if (option.gpuState?.stateKey && stateKeys.has(option.gpuState.stateKey)) continue;
        if (option.gpuState?.stateKey) stateKeys.add(option.gpuState.stateKey);
        const familyId = metrics.centroidFamilyId;
        nextBeam.push({ placements, field, remaining: state.remaining.filter(p => p.id !== option.piece.id), bounds: metrics, score: option.score + (targetFamily && targetSeedCompatible(metrics.centroidSeed, targetSeed) ? -220 : 0), hintMatches: option.hintMatches, centroidFamily: metrics.centroidFamily, centroidFamilyId: familyId, centroidSeed: metrics.centroidSeed, gpuState: option.gpuState || null });
      }
    }
    nextBeam.sort((a, b) => a.score - b.score);
    const familyBuckets = new Map();
    nextBeam.sort((a, b) => a.score - b.score);
    for (const state of nextBeam) { if (!familyBuckets.has(state.centroidFamilyId)) familyBuckets.set(state.centroidFamilyId, []); familyBuckets.get(state.centroidFamilyId).push(state); }
    const orderedBuckets = [...familyBuckets.values()].sort((a, b) => {
      if (targetNeighborCount != null) {
        const aDistance = Math.abs(a[0].centroidNeighborCount - targetNeighborCount), bDistance = Math.abs(b[0].centroidNeighborCount - targetNeighborCount);
        if (aDistance !== bDistance) return aDistance - bDistance;
      }
      if (searchHints && Object.keys(positionPreferences).length) {
        if ((a[0].hintMatches || 0) !== (b[0].hintMatches || 0)) return (b[0].hintMatches || 0) - (a[0].hintMatches || 0);
      }
      if (searchStrategy === 'breadth' && !targetFamily) {
        const aKnown = knownFamilies.has(a[0].centroidFamilyId) ? 1 : 0;
        const bKnown = knownFamilies.has(b[0].centroidFamilyId) ? 1 : 0;
        if (aKnown !== bKnown) return aKnown - bKnown;
      }
      return a[0].score - b[0].score;
    }), retained = [], retainedSet = new Set(), seedCounts = new Map();
    if (searchStrategy === 'depth') {
      for (const state of nextBeam.slice(0, BEAM_LIMIT)) { retained.push(state); retainedSet.add(state); seedCounts.set(state.centroidFamilyId, (seedCounts.get(state.centroidFamilyId) || 0) + 1); }
    } else {
      const seedQuota = searchStrategy === 'breadth' ? 3 : 8;
      for (let round = 0; round < seedQuota && retained.length < BEAM_LIMIT; round++) for (const bucket of orderedBuckets) {
        const state = bucket[round]; if (!state || retained.length >= BEAM_LIMIT) continue;
        retained.push(state); retainedSet.add(state); seedCounts.set(state.centroidFamilyId, (seedCounts.get(state.centroidFamilyId) || 0) + 1);
      }
      if (searchStrategy !== 'breadth' && retained.length < BEAM_LIMIT) for (const state of nextBeam) { if (retainedSet.has(state)) continue; retained.push(state); if (retained.length >= BEAM_LIMIT) break; }
    }
    beam.splice(0, beam.length, ...retained);
    reportProgress({ depth: depth + 1, nodes, beam: beam.length, families: seedCounts.size, frontier: nextBeam.length, cursor: { depth: depth + 1, nodeOffset: nodes, rootChoice: Number(options.rootChoice || 0) } });
  for (const state of beam) if (!state.remaining.length) {
    const metrics = fieldMetrics(state.placements, centroidId);
    const topologyMetrics = await evaluateFinalTopology(state, centroidId, frontierTopology, receipt => { frontierTopologyReceipt = receipt; });
    const acceptedMetrics = { ...metrics, ...(topologyMetrics || {}), connected: topologyMetrics?.connected ?? connected(state.field) };
    const cpuSignature = arrangementSignature(state.placements);
    if (state.gpuState?.canonicalLabels) {
      try {
        const gpuCanonicalSignature = canonicalSignatureFromLabeledFrontierState(state.gpuState);
        if (gpuCanonicalSignature !== cpuSignature) {
          frontierStateReceipt = { ...frontierStateReceipt, finalCanonicalParity: 'rejected', reason: 'canonical-signature-mismatch' };
          continue;
        }
        frontierStateReceipt = { ...frontierStateReceipt, finalCanonicalParity: 'verified', canonicalSignature: gpuCanonicalSignature };
      } catch (error) {
        frontierStateReceipt = { ...frontierStateReceipt, finalCanonicalParity: 'fallback', reason: `canonical-signature-failed:${error.message}` };
      }
    }
    if (acceptedMetrics.area === pieceCount * AREA && acceptedMetrics.holes === 0 && !acceptedMetrics.centroidEdgeCoast && acceptedMetrics.connected && !knownSignatures.has(cpuSignature)) {
      const result = { type: 'done', placements: state.placements, metrics: { width: metrics.width, height: metrics.height, area: metrics.area, holes: metrics.holes, centroidCoast: metrics.centroidCoast, centroidEdgeCoast: metrics.centroidEdgeCoast, centroidCornerCoast: metrics.centroidCornerCoast, enclosure: metrics.enclosure, centroidFamily: metrics.centroidFamily, centroidFamilyId: metrics.centroidFamilyId, centroidSeed: metrics.centroidSeed, centroidNeighborCount: metrics.centroidNeighborCount, perimeter: metrics.perimeter, density: metrics.density, centerOffset: metrics.centerOffset, centroidSquareOffset: metrics.centroidSquareOffset, centerSquareDistance: metrics.centerSquareDistance, radialVariance: metrics.radialVariance, gravityVariance: metrics.gravityVariance, gravityOffset: metrics.gravityOffset, gravityTension: metrics.gravityTension, inletCells: metrics.inletCells, inletEdges: metrics.inletEdges, inletRisk: metrics.inletRisk, peninsulaDepth: metrics.peninsulaDepth, nestedPeninsulaDepth: metrics.nestedPeninsulaDepth, terminalChains: metrics.terminalChains, score: metrics.score }, nodes, prefilter: prefilterReceipt, frontier: frontierReceipt, frontierGeneration: frontierGenerationReceipt, frontierMetrics: frontierMetricsReceipt, frontierState: frontierStateReceipt, frontierTopology: frontierTopologyReceipt };
      if (targetFamily && metrics.centroidFamilyId === targetFamily && !metrics.centroidCornerCoast && (targetNeighborCount == null || metrics.centroidNeighborCount === targetNeighborCount)) return result;
      if (!metrics.centroidCornerCoast) {
        if (!searchHints && targetNeighborCount == null) return result;
        const hintMatches = Object.entries(positionPreferences).reduce((count, [pieceId, direction]) => count + (pieceDirections(state.placements, Number(pieceId), centroidId).includes(direction) ? 1 : 0), 0);
        const familyIsNew = !knownFamilies.has(metrics.centroidFamilyId), neighborMatch = targetNeighborCount == null || metrics.centroidNeighborCount === targetNeighborCount, rank = [neighborMatch ? 0 : 1, preferNewFamily ? (familyIsNew ? 0 : 1) : 0, -hintMatches, searchQualityScore(metrics, quality)], bestRank = bestHintResult ? [bestHintResult.neighborMatch ? 0 : 1, preferNewFamily ? (bestHintResult.familyIsNew ? 0 : 1) : 0, -(bestHintResult.hintMatches || 0), searchQualityScore(bestHintResult.metrics, quality)] : null;
        if (!bestHintResult || compareResultRanks(rank, bestRank) < 0) bestHintResult = { ...result, hintMatches, neighborMatch, familyIsNew };
      }
      if (!fallback) fallback = result;
    }
  }
  }
  return bestHintResult || fallback || { type: 'done', placements: null, metrics: null, nodes, prefilter: prefilterReceipt, frontier: frontierReceipt, frontierGeneration: frontierGenerationReceipt, frontierMetrics: frontierMetricsReceipt, frontierState: frontierStateReceipt, frontierTopology: frontierTopologyReceipt };
}

export { search };
