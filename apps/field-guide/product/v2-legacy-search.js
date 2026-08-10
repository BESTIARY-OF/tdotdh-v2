/* Variable-field search worker. Keeping this off the UI thread means a hard
   combinatorial branch can be stopped without freezing or crashing the page. */
const AREA = 9;
const PIECE_COUNT = 15;
const NODE_LIMIT = 40000;
const BEAM_LIMIT = 72;
const BRANCH_LIMIT = 30;

import { createFrontierEvaluationCandidate } from '../../../packages/search-core/src/webgpu-frontier-evaluator.js';
import { createFrontierMaskFromCells } from '../../../packages/search-core/src/webgpu-frontier-validator.js';
import { createFrontierMetricsCandidate } from '../../../packages/search-core/src/webgpu-frontier-metrics.js';
import { createFieldMetricsCandidate } from '../../../packages/search-core/src/webgpu-field-metrics.js';
import { createLabeledFrontierStateCandidate } from '../../../packages/search-core/src/webgpu-labeled-frontier-state.js';
import { canonicalSignatureFromLabeledFrontierState } from '../../../packages/search-core/src/webgpu-labeled-frontier-state.js';
import { DEFAULT_FRONTIER_GRID } from '../../../packages/search-core/src/webgpu-frontier-topology.js';
import { MAX_FRONTIER_GENERATION_CANDIDATES } from '../../../packages/search-core/src/webgpu-frontier-generator.js';
import { MAX_FRONTIER_TARGET_GENERATION_CANDIDATES } from '../../../packages/search-core/src/webgpu-frontier-target-generator.js';

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
function fieldShapeMetrics(placements, map, outside, minX, maxX, minY, maxY, centroidId, aggregate = null) {
  let inletCells = aggregate ? aggregate[13] : 0, inletEdges = aggregate ? aggregate[14] : 0;
  if (!aggregate) for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
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
function fieldMetrics(placements, centroidId = 3, aggregate = null, gpuState = null) {
  const map = occupiedMap(placements), cells = [...map.keys()].map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; });
  const minX = aggregate ? aggregate[2] : Math.min(...cells.map(c => c.x)), maxX = aggregate ? aggregate[3] : Math.max(...cells.map(c => c.x)), minY = aggregate ? aggregate[4] : Math.min(...cells.map(c => c.y)), maxY = aggregate ? aggregate[5] : Math.max(...cells.map(c => c.y));
  const outside = new Set([key(minX - 1, minY - 1)]), queue = [{ x: minX - 1, y: minY - 1 }];
  while (queue.length) for (const next of adjacent(queue.shift())) { const k = key(next.x, next.y); if (outside.has(k) || map.has(k) || next.x < minX - 1 || next.x > maxX + 1 || next.y < minY - 1 || next.y > maxY + 1) continue; outside.add(k); queue.push(next); }
  let holes = 0; for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (!map.has(key(x, y)) && !outside.has(key(x, y))) holes++;
  const centroid = cells.filter(c => map.get(key(c.x, c.y)) === centroidId);
  const fieldCenter = aggregate ? { x: aggregate[6] / aggregate[0] + .5, y: aggregate[7] / aggregate[0] + .5 } : { x: cells.reduce((sum, c) => sum + c.x + .5, 0) / cells.length, y: cells.reduce((sum, c) => sum + c.y + .5, 0) / cells.length };
  const centerSquare = [...cells].sort((a, b) => Math.hypot((a.x + .5) - fieldCenter.x, (a.y + .5) - fieldCenter.y) - Math.hypot((b.x + .5) - fieldCenter.x, (b.y + .5) - fieldCenter.y) || a.y - b.y || a.x - b.x)[0];
  const centerSquareDistance = Math.hypot((centerSquare.x + .5) - fieldCenter.x, (centerSquare.y + .5) - fieldCenter.y);
  const centroidPoint = aggregate ? (aggregate[8] ? { x: aggregate[9] / aggregate[8] + .5, y: aggregate[10] / aggregate[8] + .5 } : null) : (centroid.length ? { x: centroid.reduce((sum, c) => sum + c.x + .5, 0) / centroid.length, y: centroid.reduce((sum, c) => sum + c.y + .5, 0) / centroid.length } : null);
  const centroidSquareOffset = centroidPoint ? Math.hypot(centroidPoint.x - (centerSquare.x + .5), centroidPoint.y - (centerSquare.y + .5)) : Infinity;
  const cellDistances = centroidPoint ? cells.map(c => Math.hypot(c.x + .5 - centroidPoint.x, c.y + .5 - centroidPoint.y)) : [];
  const cellMeanRadius = cellDistances.length ? cellDistances.reduce((sum, value) => sum + value, 0) / cellDistances.length : 0;
  const gravityVariance = cellDistances.length ? Math.sqrt(cellDistances.reduce((sum, value) => sum + (value - cellMeanRadius) ** 2, 0) / cellDistances.length) : Infinity;
  const gravityOffset = centroidPoint ? Math.hypot(cells.reduce((sum, c) => sum + c.x + .5 - centroidPoint.x, 0), cells.reduce((sum, c) => sum + c.y + .5 - centroidPoint.y, 0)) / cells.length : Infinity;
  const gravityTension = gravityVariance + gravityOffset * 2;
  const boundary = []; let perimeter = 0;
  for (const cell of cells) for (const next of adjacent(cell)) if (!map.has(key(next.x, next.y))) { boundary.push({ x: cell.x + (next.x - cell.x) * .5 + .5, y: cell.y + (next.y - cell.y) * .5 + .5 }); }
  perimeter = aggregate ? aggregate[1] : boundary.length;
  const coastDistances = centroidPoint ? boundary.map(c => Math.hypot(c.x - centroidPoint.x, c.y - centroidPoint.y)) : [];
  const coastMean = coastDistances.length ? coastDistances.reduce((sum, value) => sum + value, 0) / coastDistances.length : 0;
  const radialVariance = coastDistances.length ? Math.sqrt(coastDistances.reduce((sum, value) => sum + (value - coastMean) ** 2, 0) / coastDistances.length) : Infinity;
  const centerOffset = centroidPoint ? Math.hypot(centroidPoint.x - fieldCenter.x, centroidPoint.y - fieldCenter.y) : Infinity;
  const width = maxX - minX + 1, height = maxY - minY + 1, density = cells.length / (width * height);
  const centroidEdgeCoast = aggregate ? Boolean(aggregate[11]) : centroid.some(c => adjacent(c).some(next => !map.has(key(next.x, next.y))));
  const centroidCornerCoast = aggregate ? Boolean(aggregate[12]) : centroid.some(c => adjacent8(c).some(next => Math.abs(next.x - c.x) === 1 && Math.abs(next.y - c.y) === 1 && !map.has(key(next.x, next.y))));
  const centroidCoast = centroidEdgeCoast || centroidCornerCoast;
  const enclosure = centroidEdgeCoast ? 'open' : centroidCornerCoast ? 'weak' : 'strong';
  const topology = fieldShapeMetrics(placements, map, outside, minX, maxX, minY, maxY, centroidId, aggregate);
  const centroidSeed = gpuState ? (centroidSeedInfoFromGpuState(placements, centroidId, gpuState) || centroidSeedInfo(placements, centroidId)) : centroidSeedInfo(placements, centroidId);
  const enclosurePenalty = centroidEdgeCoast ? Infinity : centroidCornerCoast ? 100000 : 0;
  const score = perimeter * 1000000 + enclosurePenalty + radialVariance * 1000 + centerOffset * 100 + centroidSquareOffset * 50 + centerSquareDistance * 10 + (1 - density) * 10;
  return { map, cells, minX, maxX, minY, maxY, width, height, holes, centroidCoast, centroidEdgeCoast, centroidCornerCoast, enclosure, centroidFamily: centroidSeed.family, centroidFamilyId: centroidSeed.id, centroidSeed: centroidSeed.seed, centroidNeighborCount: centroidSeed.neighborCount, area: aggregate ? aggregate[0] : cells.length, perimeter, density, fieldCenter, centerSquare, centerSquareDistance, centroidPoint, centroidSquareOffset, centerOffset, radialVariance, gravityVariance, gravityOffset, gravityTension, score, ...topology };
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

async function generateFrontierTranslations(piece, state, bounds, frontierGenerator, onGeneration = () => {}, availabilityStatus = null, frontierCandidateRecords = null) {
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
  const records = [];
  result.origins.forEach((origin, index) => {
    if (result.validity[index] !== 1 || !origin || !Number.isSafeInteger(origin.x) || !Number.isSafeInteger(origin.y)) return;
    records.push({ pieceId: piece.id, targetOrdinal: 0, originX: origin.x, originY: origin.y, inputOrdinal: index });
  });
  const compacted = frontierCandidateRecords?.compact ? await frontierCandidateRecords.compact(records) : { records };
  const translations = new Map();
  for (const record of compacted.records || []) { const origin = { x: record.originX, y: record.originY }, originKey = `${origin.x},${origin.y}`; if (!translations.has(originKey)) translations.set(originKey, { id: piece.id, origin, cells: placedCells(piece, origin) }); }
  return [...translations.values()];
}
async function generateFrontierTranslationsBatch(pieces, state, bounds, frontierGenerator, onGeneration = () => {}, availabilityStatus = null) {
  const fallback = () => new Map(pieces.map(piece => [piece.id, candidateTranslations(piece, state.field, bounds)]));
  if (!pieces.length) return new Map();
  if (availabilityStatus && availabilityStatus.status !== 'available') {
    const translations = fallback();
    onGeneration({ status: 'fallback', backend: 'cpu-oracle', parity: 'oracle', candidateCount: [...translations.values()].reduce((sum, value) => sum + value.length, 0), batch: 'fallback' });
    return translations;
  }
  if (!frontierGenerator?.generateBatch) {
    if (!frontierGenerator?.generate) return fallback();
    const generated = new Map();
    for (const piece of pieces) generated.set(piece.id, await generateFrontierTranslations(piece, state, bounds, frontierGenerator, onGeneration, availabilityStatus));
    return generated;
  }
  const fieldCells = [...state.field].map(value => { const [x, y] = value.split(',').map(Number); return { x, y }; });
  const result = await frontierGenerator.generateBatch(pieces.map(piece => ({ pieceId: piece.id, fieldCells, pieceCells: applyLock(piece), bounds })));
  onGeneration({ status: result?.parity === 'verified' ? 'used' : 'fallback', backend: result?.backend || 'cpu-oracle', parity: result?.parity, candidateCount: result?.candidateCount || 0, batch: result?.batch || 'fallback' });
  if (!Array.isArray(result?.items)) return fallback();
  const byId = new Map();
  for (const item of result.items) {
    const piece = pieces.find(candidate => candidate.id === item.pieceId);
    if (!piece) continue;
    const translations = new Map();
    (item.origins || []).forEach((origin, index) => {
      if (item.validity?.[index] !== 1 || !origin || !Number.isSafeInteger(origin.x) || !Number.isSafeInteger(origin.y)) return;
      const cells = placedCells(piece, origin), originKey = `${origin.x},${origin.y}`;
      if (!translations.has(originKey)) translations.set(originKey, { id: piece.id, origin, cells });
    });
    byId.set(piece.id, [...translations.values()]);
  }
  return new Map(pieces.map(piece => [piece.id, byId.get(piece.id) || []]));
}
async function generateFrontierTranslationsAcrossBeam(plans, frontierGenerator, onGeneration = () => {}, availabilityStatus = null, frontierCandidateRecords = null) {
  const generated = plans.map(() => new Map());
  if (!plans.length) return generated;
  if (availabilityStatus && availabilityStatus.status !== 'available') {
    for (const [planIndex, plan] of plans.entries()) generated[planIndex] = await generateFrontierTranslationsBatch(plan.state.remaining, plan.state, plan.state.bounds, frontierGenerator, () => {}, availabilityStatus);
    onGeneration({ status: 'fallback', backend: 'cpu-oracle', parity: 'oracle', candidateCount: 0, batches: 0, batch: 'beam-fallback' });
    return generated;
  }
  if (!frontierGenerator?.generateBatch) {
    let lastReceipt = { status: 'fallback', backend: 'cpu-oracle', parity: 'oracle', candidateCount: 0 };
    for (const [planIndex, plan] of plans.entries()) generated[planIndex] = await generateFrontierTranslationsBatch(plan.state.remaining, plan.state, plan.state.bounds, frontierGenerator, receipt => { lastReceipt = receipt; }, availabilityStatus);
    onGeneration({ ...lastReceipt, batches: plans.length, batch: 'beam-fallback' });
    return generated;
  }
  const planGroups = [];
  for (const [planIndex, plan] of plans.entries()) {
    const fieldCells = [...plan.state.field].map(value => { const [x, y] = value.split(',').map(Number); return { x, y }; });
    let group = { inputs: [], refs: [], candidateCount: 0 };
    for (const piece of plan.state.remaining) {
      const input = { pieceId: `${planIndex}:${piece.id}`, fieldCells, pieceCells: applyLock(piece), bounds: plan.state.bounds }, count = fieldCells.length * 4 * input.pieceCells.length;
      if (group.inputs.length && group.candidateCount + count > MAX_FRONTIER_GENERATION_CANDIDATES) { planGroups.push(group); group = { inputs: [], refs: [], candidateCount: 0 }; }
      group.inputs.push(input); group.refs.push({ planIndex, piece }); group.candidateCount += count;
    }
    if (group.inputs.length) planGroups.push(group);
  }
  const chunks = [];
  for (const group of planGroups) {
    const previous = chunks[chunks.length - 1];
    if (previous && previous.candidateCount + group.candidateCount <= MAX_FRONTIER_GENERATION_CANDIDATES) {
      previous.inputs.push(...group.inputs); previous.refs.push(...group.refs); previous.candidateCount += group.candidateCount;
    } else chunks.push({ inputs: [...group.inputs], refs: [...group.refs], candidateCount: group.candidateCount });
  }
  const items = [];
  let totalCandidateCount = 0, batches = 0, backend = 'compute-shader', parity = 'verified', recordBackend = 'cpu-oracle', recordParity = 'oracle', recordInputCount = 0, recordOutputCount = 0;
  for (const chunk of chunks) {
    const result = await frontierGenerator.generateBatch(chunk.inputs);
    if (result?.backend) backend = result.backend;
    if (result?.status === 'completed' && Array.isArray(result.items) && result.items.length === chunk.inputs.length) {
      result.items.forEach((item, offset) => items.push({ item, ref: chunk.refs[offset] }));
    } else {
      parity = 'oracle';
      for (const ref of chunk.refs) generated[ref.planIndex].set(ref.piece.id, candidateTranslations(ref.piece, plans[ref.planIndex].state.field, plans[ref.planIndex].state.bounds));
    }
    totalCandidateCount += Number(result?.candidateCount) || chunk.candidateCount; batches += 1;
  }
  for (const { item, ref } of items) {
    const piece = ref.piece, translations = new Map(), records = [];
    (item.origins || []).forEach((origin, index) => {
      if (item.validity?.[index] !== 1 || !origin || !Number.isSafeInteger(origin.x) || !Number.isSafeInteger(origin.y)) return;
      records.push({ pieceId: piece.id, targetOrdinal: 0, originX: origin.x, originY: origin.y, inputOrdinal: index });
    });
    const compacted = frontierCandidateRecords?.compact ? await frontierCandidateRecords.compact(records) : { status: 'completed', backend: 'cpu-oracle', parity: 'oracle', inputCount: records.length, outputCount: records.length, records };
    recordBackend = compacted.backend || recordBackend; recordParity = compacted.parity || recordParity; recordInputCount += Number(compacted.inputCount) || records.length; recordOutputCount += Number(compacted.outputCount) || compacted.records?.length || 0;
    for (const record of compacted.records || []) { const origin = { x: record.originX, y: record.originY }, originKey = `${origin.x},${origin.y}`; if (!translations.has(originKey)) translations.set(originKey, { id: piece.id, origin, cells: placedCells(piece, origin) }); }
    generated[ref.planIndex].set(piece.id, [...translations.values()]);
  }
  const inputCount = planGroups.reduce((sum, group) => sum + group.inputs.length, 0);
  onGeneration({ status: items.length === inputCount ? 'used' : 'fallback', backend: items.length === inputCount ? backend : 'cpu-oracle', parity: items.length === inputCount ? parity : 'oracle', candidateCount: totalCandidateCount, batches, batch: 'beam', candidateRecords: { backend: recordBackend, parity: recordParity, inputCount: recordInputCount, outputCount: recordOutputCount } });
  return generated;
}
async function generateFrontierTargetTranslationsAcrossBeam(plans, frontierTargetGenerator, positionLocks, seedOrigin, onGeneration = () => {}, availabilityStatus = null, frontierCandidateRecords = null) {
  const generated = plans.map(() => new Map());
  if (!plans.length) return generated;
  if (!frontierTargetGenerator?.generateBatch) {
    for (const [planIndex, plan] of plans.entries()) {
      const byTarget = new Map();
      for (const target of plan.targetPool) for (const piece of plan.state.remaining) for (const candidate of candidateTranslationsForTarget(piece, plan.state.field, plan.state.bounds, target, positionLocks, seedOrigin)) {
        const targetKey = key(target.x, target.y), entries = byTarget.get(targetKey) || [];
        entries.push({ piece, candidate }); byTarget.set(targetKey, entries);
      }
      generated[planIndex] = byTarget;
    }
    onGeneration({ status: 'fallback', backend: 'cpu-oracle', parity: 'oracle', candidateCount: 0, batches: plans.length, batch: 'beam-fallback' });
    return generated;
  }
  const planGroups = [];
  for (const [planIndex, plan] of plans.entries()) {
    const fieldCells = [...plan.state.field].map(value => { const [x, y] = value.split(',').map(Number); return { x, y }; }), targetCells = plan.targetPool;
    let group = { inputs: [], refs: [], candidateCount: 0 };
    for (const piece of plan.state.remaining) {
      const lock = positionLocks[piece.id], lockedOrigin = lock ? { x: seedOrigin.x + Number(lock.dx), y: seedOrigin.y + Number(lock.dy) } : null;
      const input = { pieceId: `${planIndex}:${piece.id}`, fieldCells, targetCells, pieceCells: applyLock(piece), bounds: plan.state.bounds, lockedOrigin }, count = targetCells.length * input.pieceCells.length;
      if (group.inputs.length && group.candidateCount + count > MAX_FRONTIER_TARGET_GENERATION_CANDIDATES) { planGroups.push(group); group = { inputs: [], refs: [], candidateCount: 0 }; }
      group.inputs.push(input); group.refs.push({ planIndex, plan, piece }); group.candidateCount += count;
    }
    if (group.inputs.length) planGroups.push(group);
  }
  const chunks = [];
  for (const group of planGroups) {
    const previous = chunks[chunks.length - 1];
    if (previous && previous.candidateCount + group.candidateCount <= MAX_FRONTIER_TARGET_GENERATION_CANDIDATES) { previous.inputs.push(...group.inputs); previous.refs.push(...group.refs); previous.candidateCount += group.candidateCount; }
    else chunks.push({ inputs: [...group.inputs], refs: [...group.refs], candidateCount: group.candidateCount });
  }
  const items = [];
  let totalCandidateCount = 0, batches = 0, backend = 'compute-shader', recordBackend = 'cpu-oracle', recordParity = 'oracle', recordInputCount = 0, recordOutputCount = 0;
  for (const chunk of chunks) {
    const result = await frontierTargetGenerator.generateBatch(chunk.inputs);
    if (result?.backend) backend = result.backend;
    if (result?.status === 'completed' && Array.isArray(result.items) && result.items.length === chunk.inputs.length) result.items.forEach((item, offset) => items.push({ item, ref: chunk.refs[offset] }));
    else for (const ref of chunk.refs) for (const target of ref.plan.targetPool) for (const candidate of candidateTranslationsForTarget(ref.piece, ref.plan.state.field, ref.plan.state.bounds, target, positionLocks, seedOrigin)) { const targetKey = key(target.x, target.y), entries = generated[ref.planIndex].get(targetKey) || []; entries.push({ piece: ref.piece, candidate }); generated[ref.planIndex].set(targetKey, entries); }
    totalCandidateCount += Number(result?.candidateCount) || chunk.candidateCount; batches += 1;
  }
  for (const { item, ref } of items) {
    const byTarget = generated[ref.planIndex] || new Map(), piece = ref.piece, pieceCount = Number(item.pieceCount) || applyLock(piece).length, records = [];
    for (let index = 0; index < (item.origins || []).length; index++) {
      if (item.validity?.[index] !== 1) continue;
      const origin = item.origins[index];
      if (!origin || !Number.isSafeInteger(origin.x) || !Number.isSafeInteger(origin.y)) continue;
      records.push({ pieceId: piece.id, targetOrdinal: Math.floor(index / pieceCount), originX: origin.x, originY: origin.y, inputOrdinal: index });
    }
    const compacted = frontierCandidateRecords?.compact ? await frontierCandidateRecords.compact(records) : { status: 'completed', backend: 'cpu-oracle', parity: 'oracle', inputCount: records.length, outputCount: records.length, records };
    recordBackend = compacted.backend || recordBackend; recordParity = compacted.parity || recordParity; recordInputCount += Number(compacted.inputCount) || records.length; recordOutputCount += Number(compacted.outputCount) || compacted.records?.length || 0;
    for (const record of compacted.records || []) {
      const target = ref.plan.targetPool[record.targetOrdinal];
      if (!target) continue;
      const targetKey = key(target.x, target.y), entries = byTarget.get(targetKey) || [];
      entries.push({ piece, candidate: { id: piece.id, origin: { x: record.originX, y: record.originY }, cells: placedCells(piece, { x: record.originX, y: record.originY }) } }); byTarget.set(targetKey, entries);
    }
    generated[ref.planIndex] = byTarget;
  }
  const inputCount = planGroups.reduce((sum, group) => sum + group.inputs.length, 0);
  onGeneration({ status: items.length === inputCount ? 'used' : 'fallback', backend: items.length === inputCount ? backend : 'cpu-oracle', parity: items.length === inputCount ? 'verified' : 'oracle', candidateCount: totalCandidateCount, batches, batch: 'beam', candidateRecords: { backend: recordBackend, parity: recordParity, inputCount: recordInputCount, outputCount: recordOutputCount } });
  return generated;
}
async function generateFrontierTargetPoolsAcrossBeam(plans, frontierTargetPool, centroidId, onTargetPool = () => {}, availabilityStatus = null) {
  if (!frontierTargetPool?.generateBatch || !plans.length || availabilityStatus?.status !== 'available') return null;
  const inputs = plans.map((plan, stateId) => ({ stateId, fieldCells: [...plan.state.field].map(value => { const [x, y] = value.split(',').map(Number); return { x, y }; }), centroidCells: plan.state.placements.find(placement => placement.id === centroidId)?.cells || [] }));
  try {
    const result = await frontierTargetPool.generateBatch(inputs);
    if (result?.status === 'completed' && result.parity === 'verified' && Array.isArray(result.items) && result.items.length === plans.length) {
      onTargetPool({ status: 'used', backend: result.backend || 'compute-shader', parity: result.parity, stateCount: plans.length, candidateCount: result.items.reduce((sum, item) => sum + item.frontierCells.length + item.ringCells.length, 0), batch: 'beam' });
      return result.items;
    }
    onTargetPool({ status: 'fallback', reason: result?.reason || 'frontier-target-pool-unavailable', stateCount: plans.length });
  } catch (error) { onTargetPool({ status: 'fallback', reason: `frontier-target-pool-failed:${error.message}`, stateCount: plans.length }); }
  return null;
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
function gpuStateLabelBit(gpuState, pieceIndex, x, y) {
  const grid = DEFAULT_FRONTIER_GRID, localX = x - grid.originX, localY = y - grid.originY;
  if (localX < 0 || localY < 0 || localX >= grid.width || localY >= grid.height) return 0;
  const offset = localY * grid.width + localX, wordIndex = Math.floor(offset / 32), word = gpuState.nextLabels[pieceIndex * gpuState.wordCount + wordIndex] >>> 0;
  return (word >>> (offset % 32)) & 1;
}
function centroidSeedInfoFromGpuState(placements, centroidId, gpuState) {
  if (!gpuState || !Array.isArray(gpuState.pieceIds) || !Array.isArray(gpuState.nextLabels) || !Number.isSafeInteger(gpuState.wordCount) || gpuState.wordCount <= 0) return null;
  const centroid = placements.find(placement => placement.id === centroidId)?.cells || [], minX = centroid.length ? Math.min(...centroid.map(c => c.x)) : 0, minY = centroid.length ? Math.min(...centroid.map(c => c.y)) : 0, touching = new Map();
  const pieceIds = gpuState.pieceIds.filter(id => id !== centroidId).sort((a, b) => a - b);
  for (const id of pieceIds) {
    const pieceIndex = gpuState.pieceIds.indexOf(id), contacts = [];
    for (const center of centroid) for (const next of adjacent(center)) if (gpuStateLabelBit(gpuState, pieceIndex, next.x, next.y)) contacts.push(`${center.x - minX},${center.y - minY}>${next.x - center.x},${next.y - center.y}`);
    if (contacts.length) touching.set(id, [...new Set(contacts)].sort());
  }
  const ids = [...touching.keys()].sort((a, b) => a - b), seed = ids.map(id => `#${String(id).padStart(2, '0')}[${touching.get(id).join(';')}]`).join('|') || 'none';
  return { family: ids.length ? ids.map(id => `#${String(id).padStart(2, '0')}`).join(' + ') : 'none', seed, id: seedFamilyId(seed), neighborCount: ids.length };
}
function sameGpuState(left, right) {
  if (!left || !right || left.wordCount !== right.wordCount || left.pieceIds.length !== right.pieceIds.length || left.remainingMask.length !== right.remainingMask.length) return false;
  for (let index = 0; index < left.pieceIds.length; index++) if (left.pieceIds[index] !== right.pieceIds[index]) return false;
  for (let index = 0; index < left.remainingMask.length; index++) if (left.remainingMask[index] !== right.remainingMask[index]) return false;
  if (left.canonicalSignature || right.canonicalSignature) return left.canonicalSignature === right.canonicalSignature;
  if (!left.nextLabels || !right.nextLabels || left.nextLabels.length !== right.nextLabels.length) return false;
  for (let index = 0; index < left.nextLabels.length; index++) if (left.nextLabels[index] !== right.nextLabels[index]) return false;
  return true;
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
async function lockedSeedBranches(pieces, centroidId, seedPlacement, seedOrigin, seedSet, centroidRing, positionLocks, fieldMetricsAdapter = null, onMetrics = () => {}) {
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
  const remaining = pieces.filter(piece => piece.id !== centroidId && !lockedIds.includes(piece.id)), openTargets = [...centroidRing].filter(ringKey => !field.has(ringKey)).map(ringKey => ringKey.split(',').map(Number)).map(([x, y]) => ({ x, y })), branches = [], seenFamilies = new Set(), candidates = [];
  for (const target of openTargets) for (const piece of remaining) for (const candidate of candidateTranslationsForTarget(piece, field, lockedMetrics, target, {}, seedOrigin)) candidates.push({ piece, candidate });
  const evaluated = await evaluateFieldAggregates(candidates, { field, placements, bounds: lockedMetrics }, centroidId, fieldMetricsAdapter, onMetrics);
  for (const entry of evaluated) {
    const candidatePlacements = [...placements, entry.candidate], metrics = fieldMetrics(candidatePlacements, centroidId, entry.gpuFieldMetrics);
    if (!metrics || metrics.holes > 0 || metrics.centroidNeighborCount !== lockedIds.length + 1 || seenFamilies.has(metrics.centroidFamilyId)) continue;
    seenFamilies.add(metrics.centroidFamilyId);
    const nextField = new Set(field); entry.candidate.cells.forEach(cell => nextField.add(key(cell.x, cell.y)));
    branches.push({ placements: candidatePlacements, field: nextField, remaining: remaining.filter(item => item.id !== entry.piece.id), bounds: metrics, score: metrics.score, hintMatches: 0, centroidFamily: metrics.centroidFamily, centroidFamilyId: metrics.centroidFamilyId, centroidSeed: metrics.centroidSeed });
  }
  return branches;
}
async function targetSeedBranches(pieces, centroidId, seedPlacement, seedOrigin, seedSet, targetSeed, positionLocks, random = Math.random, fieldMetricsAdapter = null, onMetrics = () => {}) {
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
      const candidates = [];
      for (const contact of target.contacts) for (const source of applyLock(piece)) {
        const origin = { x: contact.x - source.x, y: contact.y - source.y };
        if (lockedOrigin && (origin.x !== lockedOrigin.x || origin.y !== lockedOrigin.y)) continue;
        const cells = placedCells(piece, origin), keys = cells.map(cell => key(cell.x, cell.y));
        if (keys.some(cellKey => state.field.has(cellKey))) continue;
        candidates.push({ candidate: { id: piece.id, origin, cells } });
      }
      const evaluated = await evaluateFieldAggregates(candidates, state, centroidId, fieldMetricsAdapter, onMetrics);
      for (const { candidate: placement, gpuFieldMetrics } of evaluated) {
        const keys = placement.cells.map(cell => key(cell.x, cell.y)), metrics = fieldMetrics([...state.placements, placement], centroidId, gpuFieldMetrics), actualPart = metrics.centroidSeed.split('|').find(part => part.startsWith(`#${String(piece.id).padStart(2, '0')}[`));
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

const frontierTopologyAvailability = new WeakMap();
const fieldMetricsAvailability = new WeakMap();

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

async function evaluateFrontierGeometryAcrossBeam(jobs, centroidId, frontierMetrics, onMetrics = () => {}) {
  if (!frontierMetrics?.evaluate || !jobs.length) return jobs;
  try {
    const pending = [];
    for (const [jobIndex, job] of jobs.entries()) {
      const parentCells = [...job.state.field].map(value => { const [x, y] = value.split(',').map(Number); return { x, y }; });
      const centroidCells = job.state.placements.find(placement => placement.id === centroidId)?.cells || [];
      const centroidRing = new Map();
      for (const cell of centroidCells) for (const next of adjacent(cell)) if (!centroidCells.some(other => other.x === next.x && other.y === next.y)) centroidRing.set(key(next.x, next.y), next);
      for (const [entryIndex, entry] of job.entries.entries()) pending.push({ jobIndex, entryIndex, entry, candidate: createFrontierMetricsCandidate({ parentCells, candidateCells: entry.candidate.cells, centroidCells, ringCells: [...centroidRing.values()], bounds: job.state.bounds }) });
    }
    if (!pending.length) return jobs;
    const result = await frontierMetrics.evaluate(pending.map(item => item.candidate));
    if (result?.status === 'completed' && result.parity === 'verified' && Array.isArray(result.metrics) && result.metrics.length === pending.length) {
      for (const [index, item] of pending.entries()) jobs[item.jobIndex].entries[item.entryIndex] = { ...item.entry, gpuGeometry: result.metrics[index] };
      onMetrics({ status: 'used', backend: result.backend || 'compute-shader', parity: result.parity, candidateCount: pending.length, batch: 'beam' });
      return jobs;
    }
    onMetrics({ status: 'fallback', reason: result?.reason || 'frontier-metrics-unavailable', candidateCount: pending.length, batch: 'beam' });
  } catch (error) { onMetrics({ status: 'fallback', reason: `frontier-metrics-failed:${error.message}`, batch: 'beam' }); }
  return jobs;
}

async function evaluateFieldAggregates(entries, state, centroidId, fieldMetricsAdapter, onMetrics = () => {}) {
  if (!fieldMetricsAdapter?.evaluate || !entries.length) return entries;
  try {
    if (fieldMetricsAdapter.availability) {
      let availabilityPromise = fieldMetricsAvailability.get(fieldMetricsAdapter);
      if (!availabilityPromise) { availabilityPromise = fieldMetricsAdapter.availability(); fieldMetricsAvailability.set(fieldMetricsAdapter, availabilityPromise); }
      const availability = await availabilityPromise;
      if (availability?.status !== 'available') { onMetrics({ status: 'fallback', backend: 'cpu-oracle', reason: availability?.reason || 'field-metrics-unavailable', candidateCount: entries.length }); return entries; }
    }
    const parentCells = [...state.field].map(value => { const [x, y] = value.split(',').map(Number); return { x, y }; });
    const centroidCells = state.placements.find(placement => placement.id === centroidId)?.cells || [];
    const candidates = entries.map(entry => createFieldMetricsCandidate({ occupiedCells: [...parentCells, ...entry.candidate.cells], centroidCells }));
    const result = await fieldMetricsAdapter.evaluate(candidates);
    if (Array.isArray(result?.metrics) && result.metrics.length === entries.length) {
      onMetrics({ status: result.status === 'completed' && result.parity === 'verified' ? 'used' : 'fallback', backend: result.backend || 'cpu-oracle', parity: result.parity, reason: result.reason, candidateCount: entries.length });
      return entries.map((entry, index) => ({ ...entry, gpuFieldMetrics: result.metrics[index] }));
    }
    onMetrics({ status: 'fallback', reason: result?.reason || 'field-metrics-unavailable' });
  } catch (error) { onMetrics({ status: 'fallback', reason: `field-metrics-failed:${error.message}` }); }
  return entries;
}

async function evaluateFieldAggregatesAcrossBeam(jobs, centroidId, fieldMetricsAdapter, onMetrics = () => {}) {
  if (!fieldMetricsAdapter?.evaluate || !jobs.length) return jobs;
  try {
    if (fieldMetricsAdapter.availability) {
      let availabilityPromise = fieldMetricsAvailability.get(fieldMetricsAdapter);
      if (!availabilityPromise) { availabilityPromise = fieldMetricsAdapter.availability(); fieldMetricsAvailability.set(fieldMetricsAdapter, availabilityPromise); }
      const availability = await availabilityPromise;
      if (availability?.status !== 'available') { onMetrics({ status: 'fallback', backend: 'cpu-oracle', reason: availability?.reason || 'field-metrics-unavailable', candidateCount: jobs.reduce((sum, job) => sum + job.entries.length, 0) }); return jobs; }
    }
    const pending = [];
    for (const [jobIndex, job] of jobs.entries()) {
      const parentCells = [...job.state.field].map(value => { const [x, y] = value.split(',').map(Number); return { x, y }; });
      const centroidCells = job.state.placements.find(placement => placement.id === centroidId)?.cells || [];
      for (const [entryIndex, entry] of job.entries.entries()) pending.push({ jobIndex, entryIndex, candidate: entry, fieldCandidate: createFieldMetricsCandidate({ occupiedCells: [...parentCells, ...entry.candidate.cells], centroidCells }) });
    }
    if (!pending.length) return jobs;
    const result = await fieldMetricsAdapter.evaluate(pending.map(item => item.fieldCandidate));
    if (Array.isArray(result?.metrics) && result.metrics.length === pending.length) {
      for (const [index, item] of pending.entries()) jobs[item.jobIndex].entries[item.entryIndex] = { ...item.candidate, gpuFieldMetrics: result.metrics[index] };
      onMetrics({ status: result.status === 'completed' && result.parity === 'verified' ? 'used' : 'fallback', backend: result.backend || 'cpu-oracle', parity: result.parity, reason: result.reason, candidateCount: pending.length, batch: 'beam' });
      return jobs;
    }
    onMetrics({ status: 'fallback', reason: result?.reason || 'field-metrics-unavailable', candidateCount: pending.length, batch: 'beam' });
  } catch (error) { onMetrics({ status: 'fallback', reason: `field-metrics-failed:${error.message}`, batch: 'beam' }); }
  return jobs;
}

async function evaluateFrontierState(entries, state, frontierState, onState = () => {}) {
  if (!frontierState?.transition && !frontierState?.expand || !entries.length) return entries;
  try {
    const pieceIds = [...new Set([...state.placements.map(placement => placement.id), ...state.remaining.map(piece => piece.id)])].sort((a, b) => a - b);
    const candidates = entries.map(entry => createLabeledFrontierStateCandidate({
      parentPlacements: state.placements,
      candidate: { id: entry.piece.id, cells: entry.candidate.cells },
      pieceIds,
      remainingIds: state.remaining.filter(piece => piece.id !== entry.piece.id).map(piece => piece.id),
      parentStateIndex: state.gpuState?.residentStateIndex,
    }));
    const result = frontierState.expand ? await frontierState.expand(candidates) : await frontierState.transition(candidates);
    if (result?.status === 'completed' && result.parity === 'verified' && Array.isArray(result.absoluteHashes) && result.absoluteHashes.length === entries.length) {
      onState({ status: 'used', backend: result.backend || 'compute-shader', parity: result.parity, persistent: result.persistent === true, resident: result.navigator?.status === 'resident', navigatorEpoch: result.navigator?.epoch, bufferCapacity: result.bufferCapacity, candidateCount: entries.length });
      const wordCount = Number(result.wordCount) || 0;
      const labelsPerCandidate = result.pieceIds.length * wordCount;
      return entries.map((entry, index) => {
        const labelStart = index * labelsPerCandidate;
        const canonicalLabels = result.canonicalLabels.slice(labelStart, labelStart + labelsPerCandidate);
        const remainingMask = Array.from(candidates[index].remainingMask);
        const resident = result.resident === true || result.navigator?.status === 'resident';
        const statePayload = { absoluteHash: result.absoluteHashes[index], canonicalHash: result.canonicalHashes[index], pieceIds: result.pieceIds, wordCount, remainingMask, residentStateIndex: result.residentStateIndices?.[index], residentEpoch: result.residentEpoch };
        if (resident) { statePayload.parentLabelRef = { epoch: result.residentEpoch, index: result.residentStateIndices?.[index] }; statePayload.canonicalSignature = canonicalSignatureFromLabeledFrontierState({ pieceIds: result.pieceIds, canonicalLabels, wordCount }); }
        else Object.assign(statePayload, { nextLabels: result.nextLabels.slice(labelStart, labelStart + labelsPerCandidate), canonicalLabels });
        return { ...entry, gpuState: statePayload };
      });
    }
    onState({ status: 'fallback', reason: result?.reason || 'frontier-state-unavailable' });
  } catch (error) { onState({ status: 'fallback', reason: `frontier-state-failed:${error.message}` }); }
  return entries;
}

async function evaluateFrontierStateAcrossBeam(jobs, frontierState, onState = () => {}) {
  if (!jobs.length || !jobs.some(job => job.entries.length)) return jobs;
  if (!frontierState?.transition && !frontierState?.expand) return jobs;
  try {
    const pending = [];
    for (const [jobIndex, job] of jobs.entries()) {
      const pieceIds = [...new Set([...job.state.placements.map(placement => placement.id), ...job.state.remaining.map(piece => piece.id)])].sort((a, b) => a - b);
      for (const [entryIndex, entry] of job.entries.entries()) pending.push({ jobIndex, entryIndex, entry, candidate: createLabeledFrontierStateCandidate({ parentPlacements: job.state.placements, candidate: { id: entry.piece.id, cells: entry.candidate.cells }, pieceIds, remainingIds: job.state.remaining.filter(piece => piece.id !== entry.piece.id).map(piece => piece.id), parentStateIndex: job.state.gpuState?.residentStateIndex }) });
    }
    if (!pending.length) return jobs;
    const result = frontierState.expand ? await frontierState.expand(pending.map(item => item.candidate)) : await frontierState.transition(pending.map(item => item.candidate));
    if (result?.status === 'completed' && result.parity === 'verified' && Array.isArray(result.absoluteHashes) && result.absoluteHashes.length === pending.length) {
      const wordCount = Number(result.wordCount) || 0, labelsPerCandidate = result.pieceIds.length * wordCount;
      for (const [index, item] of pending.entries()) {
        const labelStart = index * labelsPerCandidate;
        const canonicalLabels = result.canonicalLabels.slice(labelStart, labelStart + labelsPerCandidate), resident = result.resident === true || result.navigator?.status === 'resident';
        const statePayload = { absoluteHash: result.absoluteHashes[index], canonicalHash: result.canonicalHashes[index], pieceIds: result.pieceIds, wordCount, remainingMask: Array.from(item.candidate.remainingMask), residentStateIndex: result.residentStateIndices?.[index], residentEpoch: result.residentEpoch };
        if (resident) { statePayload.parentLabelRef = { epoch: result.residentEpoch, index: result.residentStateIndices?.[index] }; statePayload.canonicalSignature = canonicalSignatureFromLabeledFrontierState({ pieceIds: result.pieceIds, canonicalLabels, wordCount }); }
        else Object.assign(statePayload, { nextLabels: result.nextLabels.slice(labelStart, labelStart + labelsPerCandidate), canonicalLabels });
        jobs[item.jobIndex].entries[item.entryIndex] = { ...item.entry, gpuState: statePayload };
      }
      onState({ status: 'used', backend: result.backend || 'compute-shader', parity: result.parity, persistent: result.persistent === true, resident: result.navigator?.status === 'resident', navigatorEpoch: result.navigator?.epoch, bufferCapacity: result.bufferCapacity, candidateCount: pending.length, batch: 'beam' });
      return jobs;
    }
    onState({ status: 'fallback', reason: result?.reason || 'frontier-state-unavailable', candidateCount: pending.length, batch: 'beam' });
  } catch (error) { onState({ status: 'fallback', reason: `frontier-state-failed:${error.message}`, batch: 'beam' }); }
  return jobs;
}

async function evaluateFrontierTopology(entries, state, centroidId, frontierTopology, onTopology = () => {}, knownAvailability = null) {
  if (!frontierTopology?.evaluateBatch && !frontierTopology?.evaluate) return entries;
  try {
    if (knownAvailability && knownAvailability.status !== 'available') {
      return entries;
    }
    if (!knownAvailability && frontierTopology.availability) {
      let availabilityPromise = frontierTopologyAvailability.get(frontierTopology);
      if (!availabilityPromise) {
        availabilityPromise = frontierTopology.availability();
        frontierTopologyAvailability.set(frontierTopology, availabilityPromise);
      }
      const availability = await availabilityPromise;
      if (availability?.status !== 'available') {
        onTopology({ status: 'fallback', reason: availability?.reason || 'frontier-topology-unavailable' });
        return entries;
      }
    }
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
      const candidates = entries.map(entry => createFrontierEvaluationCandidate({ parentCells, candidateCells: entry.candidate.cells, scoreTerms: entry.metrics ? frontierScoreTerms(entry.metrics) : (entry.gpuGeometry || entry.gpuFieldMetrics) ? [0, 0, 0, 0, 0, 0, 0, 0] : frontierScoreTerms(fieldMetrics([...state.placements, entry.candidate], centroidId)) }));
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

async function evaluateFrontierOptionsAcrossBeam(jobs, centroidId, frontierEvaluator, frontierValidator, onFrontier = () => {}) {
  if (!jobs.length || !jobs.some(job => job.entries.length)) return jobs;
  try {
    const pending = [];
    for (const [jobIndex, job] of jobs.entries()) {
      const parentCells = [...job.state.field].map(value => { const [x, y] = value.split(',').map(Number); return { x, y }; });
      for (const [entryIndex, entry] of job.entries.entries()) pending.push({ jobIndex, entryIndex, entry, parentCells, candidateCells: entry.candidate.cells, candidate: createFrontierEvaluationCandidate({ parentCells, candidateCells: entry.candidate.cells, scoreTerms: entry.metrics ? frontierScoreTerms(entry.metrics) : (entry.gpuGeometry || entry.gpuFieldMetrics) ? [0, 0, 0, 0, 0, 0, 0, 0] : frontierScoreTerms(fieldMetrics([...job.state.placements, entry.candidate], centroidId)) }) });
    }
    if (!pending.length) return jobs;
    if (frontierEvaluator?.evaluate) {
      const result = await frontierEvaluator.evaluate(pending.map(item => item.candidate));
      if (Array.isArray(result?.validity) && result.validity.length === pending.length && result.status === 'completed') {
        for (const job of jobs) job.entries = [];
        for (const [index, item] of pending.entries()) if (result.validity[index] === 1) jobs[item.jobIndex].entries.push({ ...item.entry, gpuScore: result.scores?.[index] });
        onFrontier({ status: result.parity === 'verified' ? 'used' : 'fallback', backend: result.backend || 'cpu-oracle', parity: result.parity, candidateCount: pending.length, batch: 'beam' });
        return jobs;
      }
      onFrontier({ status: 'fallback', reason: result?.reason || 'frontier-evaluator-unavailable', candidateCount: pending.length, batch: 'beam' });
    }
    if (!frontierValidator?.validate) return jobs;
    const result = await frontierValidator.validate(pending.map(item => ({ parentMask: createFrontierMaskFromCells(item.parentCells), candidateMask: createFrontierMaskFromCells(item.candidateCells) })));
    if (result?.status === 'completed' && Array.isArray(result.validity) && result.validity.length === pending.length) {
      for (const job of jobs) job.entries = [];
      for (const [index, item] of pending.entries()) if (result.validity[index] === 1) jobs[item.jobIndex].entries.push(item.entry);
      onFrontier({ status: 'used', backend: result.backend || 'compute-shader', parity: result.parity, candidateCount: pending.length, batch: 'beam' });
      return jobs;
    }
    onFrontier({ status: 'fallback', reason: result?.reason || 'frontier-validator-unavailable', candidateCount: pending.length, batch: 'beam' });
  } catch (error) { onFrontier({ status: 'fallback', reason: `frontier-evaluator-failed:${error.message}`, batch: 'beam' }); }
  return jobs;
}

async function orderFrontierRows(entries, frontierRanker, onRank = () => {}) {
  if (!entries.length) return entries;
  const cpu = () => [...entries].sort((a, b) => a.score - b.score || a.tie - b.tie);
  if (!frontierRanker?.rank) { onRank({ status: 'fallback', backend: 'cpu-oracle', reason: 'frontier-ranker-unavailable', candidateCount: entries.length }); return cpu(); }
  const result = await frontierRanker.rank(entries.map((entry, index) => ({ score: entry.score, tie: index })));
  onRank({ status: result?.parity === 'verified' ? 'used' : 'fallback', backend: result?.backend || 'cpu-oracle', parity: result?.parity, candidateCount: entries.length });
  if (Array.isArray(result?.indices) && result.indices.length === entries.length) return result.indices.map(index => entries[index]);
  return cpu();
}

async function rankFrontierOptions(entries, frontierRanker, onRank = () => {}) {
  return (await orderFrontierRows(entries, frontierRanker, onRank)).slice(0, BRANCH_LIMIT);
}

async function compactFrontierRows(entries, retain, frontierCompactor, onCompact = () => {}) {
  const cpu = () => entries.map((entry, index) => ({ entry, index })).sort((left, right) => left.entry.score - right.entry.score || left.index - right.index).slice(0, retain).map(row => row.entry);
  if (!frontierCompactor?.compact) { onCompact({ status: 'fallback', backend: 'cpu-oracle', parity: 'oracle', candidateCount: entries.length, selectedCount: Math.min(entries.length, retain) }); return cpu(); }
  const result = await frontierCompactor.compact(entries.map((entry, index) => ({ score: entry.score, tie: entry.tie ?? index })), retain);
  onCompact({ status: result?.parity === 'verified' ? 'used' : 'fallback', backend: result?.backend || 'cpu-oracle', parity: result?.parity, algorithm: result?.algorithm, persistent: result?.persistent === true, bufferCapacity: result?.bufferCapacity, candidateCount: entries.length, selectedCount: result?.selectedCount || 0, reason: result?.reason });
  if (Array.isArray(result?.indices) && result.indices.length <= retain) return result.indices.map(index => entries[index]).filter(Boolean);
  return cpu();
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

async function searchLockedSeedBranches(pieces, branches, knownFamilies, centroidId, targetNeighborCount, allowKnownFamily = false, knownSignatures = new Set(), searchHints = false, positionPreferences = {}, random = Math.random, quality = {}, candidatePrefilter = null, onPrefilter = () => {}, frontierValidator = null, frontierEvaluator = null, frontierGenerator = null, frontierGeneratorStatus = null, onFrontier = () => {}, onGeneration = () => {}, isCancelled = () => {}, frontierMetrics = null, onMetrics = () => {}, frontierState = null, onState = () => {}, frontierTopology = null, onTopology = () => {}, fieldMetricsAdapter = null, frontierTargetPool = null, frontierTargetPoolStatus = null, onTargetPool = () => {}, frontierNavigator = null, frontierCandidateRecords = null) {
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
      let targetPool = null;
      if (frontierTargetPool?.generateBatch && frontierTargetPoolStatus?.status === 'available') {
        try {
          const centroidCells = state.placements.find(placement => placement.id === centroidId)?.cells || [];
          const poolResult = await frontierTargetPool.generateBatch([{ stateId: nodes, fieldCells: [...state.field].map(value => { const [x, y] = value.split(',').map(Number); return { x, y }; }), centroidCells }]);
          const item = poolResult?.items?.[0];
          if (poolResult?.status === 'completed' && poolResult.parity === 'verified' && item) {
            targetPool = item;
            onTargetPool({ status: 'used', backend: poolResult.backend || 'compute-shader', parity: poolResult.parity, batch: 'locked-branch', states: 1, cells: poolResult.cellCount || 0 });
          } else {
            onTargetPool({ status: 'fallback', backend: 'cpu-oracle', reason: poolResult?.reason || 'frontier-target-pool-unavailable', batch: 'locked-branch' });
          }
        } catch (error) {
          onTargetPool({ status: 'fallback', backend: 'cpu-oracle', reason: `frontier-target-pool-failed:${error.message}`, batch: 'locked-branch' });
        }
      }
      const targetKeys = targetPool ? new Set([...targetPool.frontierCells, ...targetPool.ringCells].map(cell => key(cell.x, cell.y))) : null;
      const touchesGpuTargetPool = candidate => !targetKeys || candidate.cells.some(cell => targetKeys.has(key(cell.x, cell.y)));
      const choices = [];
      for (const piece of state.remaining) {
        let options = (await generateFrontierTranslations(piece, state, state.bounds, frontierGenerator, onGeneration, frontierGeneratorStatus, frontierCandidateRecords)).map(candidate => ({ piece, candidate }));
        if (targetKeys) options = options.filter(entry => touchesGpuTargetPool(entry.candidate));
        options = await evaluateFieldAggregates(options, state, centroidId, fieldMetricsAdapter, onMetrics);
        options = options.map(({ candidate, gpuFieldMetrics }) => {
          const placements = [...state.placements, candidate], metrics = fieldMetrics(placements, centroidId, gpuFieldMetrics);
          const hint = searchHints && positionPreferences[piece.id] ? pieceDirections(placements, piece.id, centroidId).includes(positionPreferences[piece.id]) : false;
          return metrics.holes === 0 ? { piece, candidate, gpuFieldMetrics, metrics, hintMatches: (state.hintMatches || 0) + (hint ? 1 : 0) } : null;
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
        const stateEngine = frontierNavigator || frontierState;
        stateEngine?.beginLayer?.();
        options = await evaluateFrontierState(options, state, stateEngine, onState);
        stateEngine?.commitLayer?.();
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
  const frontierTargetGenerator = options.frontierTargetGenerator;
  const frontierTargetPool = options.frontierTargetPool;
  const frontierCandidateRecords = options.frontierCandidateRecords;
  const frontierMetrics = options.frontierMetrics;
  const fieldMetricsAdapter = options.fieldMetrics;
  const frontierState = options.frontierState;
  const frontierNavigator = options.frontierNavigator;
  const frontierTopology = options.frontierTopology;
  const frontierRanker = options.frontierRanker;
  const frontierCompactor = options.frontierCompactor;
  const frontierDeduplicator = options.frontierDeduplicator;
  const frontierTopologyAvailabilityReceipt = frontierTopology?.availability ? await frontierTopology.availability() : null;
  const frontierGeneratorStatus = frontierGenerator?.availability ? await frontierGenerator.availability() : null;
  const frontierTargetGeneratorStatus = frontierTargetGenerator?.availability ? await frontierTargetGenerator.availability() : null;
  const frontierTargetPoolStatus = frontierTargetPool?.availability ? await frontierTargetPool.availability() : null;
  const frontierDeduplicatorStatus = frontierDeduplicator?.availability ? await frontierDeduplicator.availability() : null;
  let prefilterReceipt = { status: 'cpu-oracle' }, frontierReceipt = { status: 'cpu-oracle' }, frontierGenerationReceipt = { status: 'cpu-oracle' }, frontierTargetGenerationReceipt = { status: 'cpu-oracle' }, frontierTargetPoolReceipt = { status: 'cpu-oracle' }, frontierMetricsReceipt = { status: 'cpu-oracle' }, fieldMetricsReceipt = { status: 'cpu-oracle' }, frontierStateReceipt = { status: 'cpu-oracle' }, frontierTopologyReceipt = { status: 'cpu-oracle' }, frontierRankerReceipt = { status: 'cpu-oracle' }, frontierCompactorReceipt = { status: 'cpu-oracle' }, frontierDedupReceipt = { status: 'cpu-oracle' };
  if (frontierTargetGeneratorStatus?.status !== 'available' && frontierTargetGeneratorStatus) frontierTargetGenerationReceipt = { status: 'fallback', reason: frontierTargetGeneratorStatus.reason || 'frontier-target-generator-unavailable' };
  if (frontierTargetPoolStatus?.status !== 'available' && frontierTargetPoolStatus) frontierTargetPoolReceipt = { status: 'fallback', reason: frontierTargetPoolStatus.reason || 'frontier-target-pool-unavailable' };
  if (frontierDeduplicatorStatus?.status !== 'available' && frontierDeduplicatorStatus) frontierDedupReceipt = { status: 'fallback', reason: frontierDeduplicatorStatus.reason || 'frontier-deduplicator-unavailable' };
  if (frontierTopologyAvailabilityReceipt?.status !== 'available' && frontierTopologyAvailabilityReceipt) frontierTopologyReceipt = { status: 'fallback', reason: frontierTopologyAvailabilityReceipt.reason || 'frontier-topology-unavailable' };
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
  async function deduplicateRankedOptions(entries, state) {
    if (!frontierDeduplicator?.deduplicate || !entries.length || frontierDeduplicatorStatus?.status !== 'available') return entries;
    if (entries.some(entry => !entry.gpuState)) {
      if (frontierDedupReceipt.status === 'cpu-oracle') frontierDedupReceipt = { status: 'fallback', reason: 'gpu-state-unavailable' };
      return entries;
    }
    const rows = entries.map(entry => ({ hash: entry.gpuState.absoluteHash >>> 0, signature: arrangementSignature([...state.placements, entry.candidate]) }));
    const result = await frontierDeduplicator.deduplicate(rows);
    if (result?.status === 'completed' && result?.parity === 'verified' && Array.isArray(result.keep) && result.keep.length === entries.length) {
      frontierDedupReceipt = { status: 'used', backend: result.backend || 'compute-shader', parity: result.parity, candidateCount: entries.length, batch: 'beam' };
      return entries.filter((entry, index) => result.keep[index] === 1);
    }
    if (frontierDedupReceipt.status === 'cpu-oracle') frontierDedupReceipt = { status: 'fallback', reason: result?.reason || 'frontier-deduplicator-unavailable' };
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
  const navigationBatch = typeof options.navigationBatch === 'function' ? options.navigationBatch : null;
  const navigationCancellation = typeof options.navigationCancellation === 'function' ? options.navigationCancellation : null;
  const navigationTicket = options.navigationTicket || null;
  const navigationCursor = options.navigationCursor || null;
  const navigationExpansionBackend = frontierTargetGeneratorStatus?.status === 'available' ? 'webgpu' : frontierGeneratorStatus?.status === 'available' ? 'webgpu' : 'cpu-oracle';
  const reportProgress = typeof options.reportProgress === 'function'
    ? options.reportProgress
    : progress => postMessage({ type: 'progress', ...progress });
  const random = seededRandom(options.searchSalt || `${targetFamily || 'open'}:${options.rootChoice || 0}`);
  const preferNewFamily = searchStrategy === 'breadth' && !targetFamily;
  const centroidId = Number(options.centroidId || 3), centroidPiece = pieces.find(p => p.id === centroidId), centerShape = applyLock(centroidPiece), centerSize = shapeSize(centerShape), seedOrigin = { x: -Math.floor(centerSize.width / 2), y: -Math.floor(centerSize.height / 2) }, seedCells = placedCells(centroidPiece, seedOrigin), seedPlacement = { id: centroidId, origin: seedOrigin, cells: seedCells };
  const seedSet = new Set(seedCells.map(c => key(c.x, c.y))), centroidRing = new Set(); seedCells.forEach(cell => adjacent(cell).forEach(next => { if (!seedSet.has(key(next.x, next.y))) centroidRing.add(key(next.x, next.y)); }));
  const checkpointSchema = 'tdotdh.product-search-checkpoint.v0';
  const serializeCheckpoint = (beam, depth, nodeOffset) => ({ schema: checkpointSchema, depth, nodeOffset, strategy: searchStrategy, centroidId, targetFamily, targetSeed, threadId: Number(options.threadId || 0), searchSalt: options.searchSalt || `${targetFamily || 'open'}:${options.rootChoice || 0}`, beam: beam.slice(0, BEAM_LIMIT).map(state => ({ placements: state.placements.map(placement => ({ id: placement.id, origin: placement.origin, cells: placement.cells })), score: Number(state.score) || 0, hintMatches: Number(state.hintMatches) || 0 })) });
  const restoreCheckpoint = checkpoint => {
    if (!checkpoint || checkpoint.schema !== checkpointSchema || checkpoint.strategy !== searchStrategy || Number(checkpoint.centroidId) !== centroidId || (checkpoint.targetFamily || null) !== targetFamily || (checkpoint.targetSeed || null) !== targetSeed || !Array.isArray(checkpoint.beam) || checkpoint.beam.length === 0) return null;
    const beam = [];
    for (const savedState of checkpoint.beam.slice(0, BEAM_LIMIT)) {
      if (!Array.isArray(savedState?.placements) || !savedState.placements.length) return null;
      const placements = savedState.placements.map(placement => ({ id: Number(placement.id), origin: { x: Number(placement.origin?.x), y: Number(placement.origin?.y) }, cells: Array.isArray(placement.cells) ? placement.cells.map(cell => ({ x: Number(cell.x), y: Number(cell.y) })) : [] }));
      if (placements.some(placement => !Number.isInteger(placement.id) || !Number.isInteger(placement.origin.x) || !Number.isInteger(placement.origin.y) || !placement.cells.length || placement.cells.some(cell => !Number.isInteger(cell.x) || !Number.isInteger(cell.y)))) return null;
      const ids = new Set(placements.map(placement => placement.id));
      if (ids.size !== placements.length || !ids.has(centroidId) || [...ids].some(id => !pieces.some(piece => piece.id === id))) return null;
      const field = new Set(placements.flatMap(placement => placement.cells.map(cell => key(cell.x, cell.y))));
      const cellCount = placements.reduce((sum, placement) => sum + placement.cells.length, 0);
      if (field.size !== cellCount) return null;
      const bounds = fieldMetrics(placements, centroidId);
      beam.push({ placements, field, remaining: pieces.filter(piece => !ids.has(piece.id)), bounds, score: Number(savedState.score) || 0, hintMatches: Number(savedState.hintMatches) || 0, centroidFamily: bounds.centroidFamily, centroidFamilyId: bounds.centroidFamilyId, centroidSeed: bounds.centroidSeed, gpuState: null });
    }
    return { beam, depth: Math.max(0, Number(checkpoint.depth) || 0), nodeOffset: Math.max(0, Number(checkpoint.nodeOffset) || 0) };
  };
  const restored = restoreCheckpoint(options.resumeCheckpoint);
  const seed = { placements: [seedPlacement], field: new Set(seedCells.map(c => key(c.x, c.y))), remaining: pieces.filter(p => p.id !== centroidId), bounds: fieldMetrics([seedPlacement], centroidId), hintMatches: 0 }, seedBranches = restored ? [] : searchStrategy === 'breadth' ? await lockedSeedBranches(pieces, centroidId, seedPlacement, seedOrigin, seedSet, centroidRing, positionLocks, fieldMetricsAdapter, receipt => { fieldMetricsReceipt = receipt; }) : targetFamily ? await targetSeedBranches(pieces, centroidId, seedPlacement, seedOrigin, seedSet, targetSeed, positionLocks, random, fieldMetricsAdapter, receipt => { fieldMetricsReceipt = receipt; }) : [];
  if (seedBranches.length) {
    const lockedResult = await searchLockedSeedBranches(pieces, seedBranches, knownFamilies, centroidId, targetNeighborCount, Boolean(targetFamily), knownSignatures, searchHints, positionPreferences, random, quality, candidatePrefilter, receipt => { prefilterReceipt = receipt; }, options.frontierValidator, frontierEvaluator, frontierGenerator, frontierGeneratorStatus, receipt => { frontierReceipt = receipt; }, receipt => { frontierGenerationReceipt = receipt; }, isCancelled, options.frontierMetrics, receipt => { frontierMetricsReceipt = receipt; }, options.frontierState, receipt => { frontierStateReceipt = receipt; }, frontierTopology, receipt => { frontierTopologyReceipt = receipt; }, fieldMetricsAdapter, frontierTargetPool, frontierTargetPoolStatus, receipt => { frontierTargetPoolReceipt = receipt; }, frontierNavigator, frontierCandidateRecords);
    return { ...lockedResult, prefilter: prefilterReceipt, frontier: frontierReceipt, frontierGeneration: frontierGenerationReceipt, frontierTargetGeneration: frontierTargetGenerationReceipt, frontierTargetPool: frontierTargetPoolReceipt, frontierMetrics: frontierMetricsReceipt, fieldMetrics: fieldMetricsReceipt, frontierState: frontierStateReceipt, frontierTopology: frontierTopologyReceipt, frontierRanker: frontierRankerReceipt, frontierCompactor: frontierCompactorReceipt, frontierDedup: frontierDedupReceipt };
  }
  const beam = restored?.beam || [seed];
  const restoredNodeOffset = restored?.nodeOffset || 0;
  let nodes = 0, fallback = null, bestHintResult = null, lastDepth = restored?.depth || 0;
  const pieceCount = pieces.length;
  for (let depth = restored?.depth || 0; depth < pieceCount - 1 && beam.length && nodes < NODE_LIMIT; depth++) {
    const cancelled = isCancelled();
    if (navigationCancellation) navigationCancellation(cancelled);
    if (cancelled) return { type: 'done', placements: null, metrics: null, nodes, prefilter: prefilterReceipt, frontier: frontierReceipt, frontierGeneration: frontierGenerationReceipt, frontierTargetPool: frontierTargetPoolReceipt, frontierMetrics: frontierMetricsReceipt, fieldMetrics: fieldMetricsReceipt, frontierState: frontierStateReceipt, frontierTopology: frontierTopologyReceipt, frontierDedup: frontierDedupReceipt };
    const navigationBatchReceipt = navigationBatch?.({ stage: 'frontier-expansion', backend: navigationExpansionBackend, ownership: navigationExpansionBackend === 'webgpu' ? 'gpu-first' : 'cpu-oracle-fallback', depth, nodeOffset: restoredNodeOffset + nodes, candidateCount: beam.length });
    const nextBeam = [];
    const gpuStateBuckets = new Map();
    const cpuStateKeys = new Set();
    const beamJobs = [];
    const beamPlans = [];
    for (const state of beam) {
      if (isCancelled()) return { type: 'done', placements: null, metrics: null, nodes, prefilter: prefilterReceipt, frontier: frontierReceipt, frontierGeneration: frontierGenerationReceipt, frontierTargetPool: frontierTargetPoolReceipt, frontierMetrics: frontierMetricsReceipt, fieldMetrics: fieldMetricsReceipt, frontierState: frontierStateReceipt, frontierTopology: frontierTopologyReceipt, frontierDedup: frontierDedupReceipt };
      if (nodes >= NODE_LIMIT) break;
      beamPlans.push({ state });
    }
    const gpuTargetPools = await generateFrontierTargetPoolsAcrossBeam(beamPlans, frontierTargetPool, centroidId, receipt => { frontierTargetPoolReceipt = receipt; }, frontierTargetPoolStatus);
    for (const [planIndex, plan] of beamPlans.entries()) {
      const state = plan.state, openCentroid = [...centroidRing].filter(ringKey => !state.field.has(ringKey)), frontier = new Map();
      for (const cellKey of state.field) {
        const [x, y] = cellKey.split(',').map(Number);
        for (const next of adjacent({ x, y })) if (!state.field.has(key(next.x, next.y))) frontier.set(key(next.x, next.y), next);
      }
      const gpuPool = gpuTargetPools?.[planIndex], gpuRing = gpuPool ? new Set(gpuPool.ringCells.map(cell => key(cell.x, cell.y))) : null, gpuFrontier = gpuPool ? new Set(gpuPool.frontierCells.map(cell => key(cell.x, cell.y))) : null;
      const ringTargets = openCentroid.map(ringKey => frontier.get(ringKey)).filter(cell => cell && (!gpuRing || gpuRing.has(key(cell.x, cell.y)))), frontierTargets = [...frontier.values()].filter(cell => !gpuFrontier || gpuFrontier.has(key(cell.x, cell.y)));
      plan.targetPool = ringTargets.length ? ringTargets : frontierTargets;
    }
    for (let index = beamPlans.length - 1; index >= 0; index--) if (!beamPlans[index].targetPool?.length) beamPlans.splice(index, 1);
    const useTargetGeneratedFrontier = frontierTargetGeneratorStatus?.status === 'available';
    const generatedByTargetBeam = useTargetGeneratedFrontier
      ? await generateFrontierTargetTranslationsAcrossBeam(beamPlans, frontierTargetGenerator, positionLocks, seedOrigin, receipt => { frontierTargetGenerationReceipt = receipt; }, frontierTargetGeneratorStatus, frontierCandidateRecords)
      : null;
    const useGeneratedFrontier = !useTargetGeneratedFrontier && frontierGeneratorStatus?.status === 'available';
    const generatedByBeam = useGeneratedFrontier
      ? await generateFrontierTranslationsAcrossBeam(beamPlans, frontierGenerator, receipt => { frontierGenerationReceipt = receipt; }, frontierGeneratorStatus, frontierCandidateRecords)
      : null;
    if (!useGeneratedFrontier && frontierGenerator?.generate && frontierGenerationReceipt.status === 'cpu-oracle') frontierGenerationReceipt = { status: 'fallback', backend: 'cpu-oracle', parity: 'oracle', candidateCount: 0 };
    if (navigationBatchReceipt) {
      const annotate = receipt => receipt?.status ? { ...receipt, navigationBatch: navigationBatchReceipt } : receipt;
      frontierTargetPoolReceipt = annotate(frontierTargetPoolReceipt);
      frontierTargetGenerationReceipt = annotate(frontierTargetGenerationReceipt);
      frontierGenerationReceipt = annotate(frontierGenerationReceipt);
    }
    for (const [planIndex, plan] of beamPlans.entries()) {
      const state = plan.state, generatedByPiece = generatedByBeam?.[planIndex] || null, generatedByTarget = generatedByTargetBeam?.[planIndex] || null;
      let selectedOptions = null;
      for (const target of plan.targetPool) {
        const options = [];
        for (const piece of state.remaining) {
          if (useTargetGeneratedFrontier) { options.push(...(generatedByTarget.get(key(target.x, target.y)) || []).filter(entry => entry.piece.id === piece.id)); continue; }
          const generated = useGeneratedFrontier ? (generatedByPiece.get(piece.id) || []) : candidateTranslationsForTarget(piece, state.field, state.bounds, target, positionLocks, seedOrigin);
          if (!useGeneratedFrontier) { for (const candidate of generated) options.push({ piece, candidate }); continue; }
          const targetKey = key(target.x, target.y);
          for (const candidate of generated) if (candidate.cells?.some(cell => key(cell.x, cell.y) === targetKey)) options.push({ piece, candidate });
        }
        if (options.length && (!selectedOptions || options.length < selectedOptions.length)) selectedOptions = options;
      }
      if (!selectedOptions) continue;
      selectedOptions = await filterCandidates(selectedOptions);
      if (selectedOptions.length) beamJobs.push({ state, entries: selectedOptions });
    }
    await evaluateFrontierGeometryAcrossBeam(beamJobs, centroidId, frontierMetrics, receipt => { frontierMetricsReceipt = receipt; });
    await evaluateFieldAggregatesAcrossBeam(beamJobs, centroidId, fieldMetricsAdapter, receipt => { fieldMetricsReceipt = receipt; });
    await evaluateFrontierOptionsAcrossBeam(beamJobs, centroidId, frontierEvaluator, options.frontierValidator, receipt => { frontierReceipt = { ...receipt, ...(navigationTicket ? { ticket: navigationTicket } : {}), ...(navigationCursor ? { cursor: { ...navigationCursor, depth, nodeOffset: navigationCursor.nodeOffset + nodes } } : {}) }; });
    frontierNavigator?.beginLayer?.();
    await evaluateFrontierStateAcrossBeam(beamJobs, frontierNavigator || frontierState, receipt => { frontierStateReceipt = receipt; });
    frontierNavigator?.commitLayer?.();
    const cancelledAfterGpu = isCancelled();
    if (navigationCancellation) navigationCancellation(cancelledAfterGpu);
    if (cancelledAfterGpu) return { type: 'done', placements: null, metrics: null, nodes, prefilter: prefilterReceipt, frontier: frontierReceipt, frontierGeneration: frontierGenerationReceipt, frontierTargetGeneration: frontierTargetGenerationReceipt, frontierTargetPool: frontierTargetPoolReceipt, frontierMetrics: frontierMetricsReceipt, fieldMetrics: fieldMetricsReceipt, frontierState: frontierStateReceipt, frontierTopology: frontierTopologyReceipt, frontierDedup: frontierDedupReceipt };
    for (const job of beamJobs) {
      const state = job.state;
      let selectedOptions = job.entries;
      selectedOptions = await evaluateFrontierTopology(selectedOptions, state, centroidId, frontierTopology, receipt => { frontierTopologyReceipt = receipt; }, frontierTopologyAvailabilityReceipt);
      if (!selectedOptions.length) continue;
      const rankedCandidates = selectedOptions.map(({ piece, candidate, gpuGeometry, gpuFieldMetrics, gpuState, gpuTopology }) => {
        const nextBounds = { minX: Math.min(state.bounds.minX, ...candidate.cells.map(c => c.x)), maxX: Math.max(state.bounds.maxX, ...candidate.cells.map(c => c.x)), minY: Math.min(state.bounds.minY, ...candidate.cells.map(c => c.y)), maxY: Math.max(state.bounds.maxY, ...candidate.cells.map(c => c.y)) };
        const contact = candidate.cells.reduce((n, c) => n + adjacent(c).filter(a => state.field.has(key(a.x, a.y))).length, 0), centroidContact = candidate.cells.reduce((n, c) => n + adjacent8(c).filter(a => seedSet.has(key(a.x, a.y))).length, 0), ringCoverage = candidate.cells.reduce((n, c) => n + (centroidRing.has(key(c.x, c.y)) ? 1 : 0), 0), openCentroid = [...centroidRing].filter(ringKey => !state.field.has(ringKey) && !candidate.cells.some(c => key(c.x, c.y) === ringKey)).length;
        nodes++;
        const candidatePlacements = [...state.placements, candidate], candidateMetrics = fieldMetrics(candidatePlacements, centroidId, gpuFieldMetrics, gpuState), candidateFamilyTarget = candidateMetrics.centroidSeed === 'none' || targetSeedCompatible(candidateMetrics.centroidSeed, targetSeed);
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
        return { piece, candidate, gpuState, metrics: candidateMetrics, score: geometryScore + targetBonus + noveltyBonus + neighborTargetBonus + hintBonus + qualityPenalty + random() * 12, nextBounds, hintMatches };
      }).filter(Boolean);
      const ranked = await rankFrontierOptions(rankedCandidates, frontierRanker, receipt => { frontierRankerReceipt = receipt; });
      const deduplicated = await deduplicateRankedOptions(ranked, state);
      for (const option of deduplicated) {
        const placements = [...state.placements, option.candidate], metrics = option.metrics, field = new Set(state.field); option.candidate.cells.forEach(c => field.add(key(c.x, c.y)));
        if (metrics.holes > 0) continue;
        if (option.gpuState) {
          const hash = String(option.gpuState.absoluteHash >>> 0), bucket = gpuStateBuckets.get(hash) || [];
          if (bucket.some(existing => sameGpuState(existing, option.gpuState))) continue;
          bucket.push(option.gpuState); gpuStateBuckets.set(hash, bucket);
        } else {
          const cpuStateKey = arrangementSignature(placements);
          if (cpuStateKeys.has(cpuStateKey)) continue;
          cpuStateKeys.add(cpuStateKey);
        }
        const familyId = metrics.centroidFamilyId;
        nextBeam.push({ placements, field, remaining: state.remaining.filter(p => p.id !== option.piece.id), bounds: metrics, score: option.score + (targetFamily && targetSeedCompatible(metrics.centroidSeed, targetSeed) ? -220 : 0), hintMatches: option.hintMatches, centroidFamily: metrics.centroidFamily, centroidFamilyId: familyId, centroidSeed: metrics.centroidSeed, gpuState: option.gpuState || null });
      }
    }
    const familyBuckets = new Map();
    for (const state of nextBeam) { if (!familyBuckets.has(state.centroidFamilyId)) familyBuckets.set(state.centroidFamilyId, []); familyBuckets.get(state.centroidFamilyId).push(state); }
    if (searchStrategy === 'breadth') {
      for (const [familyId, bucket] of familyBuckets) familyBuckets.set(familyId, await orderFrontierRows(bucket, frontierRanker, receipt => { frontierRankerReceipt = receipt; }));
    }
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
      const compactedBeam = await compactFrontierRows(nextBeam.map((state, index) => ({ state, score: state.score, tie: index })), BEAM_LIMIT, frontierCompactor, receipt => { frontierCompactorReceipt = receipt; });
      for (const { state } of compactedBeam) { retained.push(state); retainedSet.add(state); seedCounts.set(state.centroidFamilyId, (seedCounts.get(state.centroidFamilyId) || 0) + 1); }
    } else {
      const seedQuota = searchStrategy === 'breadth' ? 3 : 8;
      if (searchStrategy === 'breadth') {
        const quotaRows = [];
        for (let round = 0; round < seedQuota; round++) for (const [bucketIndex, bucket] of orderedBuckets.entries()) {
          const state = bucket[round]; if (!state) continue;
          quotaRows.push({ state, score: round * 4096 + bucketIndex, tie: quotaRows.length });
        }
        const compactedQuota = await compactFrontierRows(quotaRows, BEAM_LIMIT, frontierCompactor, receipt => { frontierCompactorReceipt = { ...receipt, batch: 'breadth-quota' }; });
        for (const { state } of compactedQuota) { retained.push(state); retainedSet.add(state); seedCounts.set(state.centroidFamilyId, (seedCounts.get(state.centroidFamilyId) || 0) + 1); }
      } else for (let round = 0; round < seedQuota && retained.length < BEAM_LIMIT; round++) for (const bucket of orderedBuckets) {
        const state = bucket[round]; if (!state || retained.length >= BEAM_LIMIT) continue;
        retained.push(state); retainedSet.add(state); seedCounts.set(state.centroidFamilyId, (seedCounts.get(state.centroidFamilyId) || 0) + 1);
      }
      if (searchStrategy !== 'breadth' && retained.length < BEAM_LIMIT) for (const state of nextBeam) { if (retainedSet.has(state)) continue; retained.push(state); if (retained.length >= BEAM_LIMIT) break; }
    }
    beam.splice(0, beam.length, ...retained);
    const checkpoint = serializeCheckpoint(beam, depth + 1, restoredNodeOffset + nodes);
    reportProgress({ depth: depth + 1, nodes, beam: beam.length, families: seedCounts.size, frontier: nextBeam.length, cursor: { depth: depth + 1, nodeOffset: restoredNodeOffset + nodes, rootChoice: Number(options.rootChoice || 0), checkpoint } });
    lastDepth = depth + 1;
  for (const state of beam) if (!state.remaining.length) {
    const metrics = fieldMetrics(state.placements, centroidId);
    const topologyMetrics = await evaluateFinalTopology(state, centroidId, frontierTopology, receipt => { frontierTopologyReceipt = receipt; });
    const acceptedMetrics = { ...metrics, ...(topologyMetrics || {}), connected: topologyMetrics?.connected ?? connected(state.field) };
    const cpuSignature = arrangementSignature(state.placements);
    if (state.gpuState?.canonicalSignature) {
      if (state.gpuState.canonicalSignature !== cpuSignature) {
        frontierStateReceipt = { ...frontierStateReceipt, finalCanonicalParity: 'rejected', reason: 'canonical-signature-mismatch' };
        continue;
      }
      frontierStateReceipt = { ...frontierStateReceipt, finalCanonicalParity: 'verified', canonicalSignature: state.gpuState.canonicalSignature };
    } else if (state.gpuState?.canonicalLabels) {
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
      const result = { type: 'done', placements: state.placements, metrics: { width: metrics.width, height: metrics.height, area: metrics.area, holes: metrics.holes, centroidCoast: metrics.centroidCoast, centroidEdgeCoast: metrics.centroidEdgeCoast, centroidCornerCoast: metrics.centroidCornerCoast, enclosure: metrics.enclosure, centroidFamily: metrics.centroidFamily, centroidFamilyId: metrics.centroidFamilyId, centroidSeed: metrics.centroidSeed, centroidNeighborCount: metrics.centroidNeighborCount, perimeter: metrics.perimeter, density: metrics.density, centerOffset: metrics.centerOffset, centroidSquareOffset: metrics.centroidSquareOffset, centerSquareDistance: metrics.centerSquareDistance, radialVariance: metrics.radialVariance, gravityVariance: metrics.gravityVariance, gravityOffset: metrics.gravityOffset, gravityTension: metrics.gravityTension, inletCells: metrics.inletCells, inletEdges: metrics.inletEdges, inletRisk: metrics.inletRisk, peninsulaDepth: metrics.peninsulaDepth, nestedPeninsulaDepth: metrics.nestedPeninsulaDepth, terminalChains: metrics.terminalChains, score: metrics.score }, nodes, prefilter: prefilterReceipt, frontier: frontierReceipt, frontierGeneration: frontierGenerationReceipt, frontierTargetGeneration: frontierTargetGenerationReceipt, frontierTargetPool: frontierTargetPoolReceipt, frontierMetrics: frontierMetricsReceipt, fieldMetrics: fieldMetricsReceipt, frontierState: frontierStateReceipt, frontierTopology: frontierTopologyReceipt, frontierRanker: frontierRankerReceipt, frontierCompactor: frontierCompactorReceipt, frontierDedup: frontierDedupReceipt };
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
  const terminalCheckpoint = serializeCheckpoint(beam, Math.min(pieceCount - 1, lastDepth), restoredNodeOffset + nodes);
  return bestHintResult || fallback || { type: 'done', placements: null, metrics: null, nodes, cursor: { depth: terminalCheckpoint.depth, nodeOffset: terminalCheckpoint.nodeOffset, rootChoice: Number(options.rootChoice || 0), checkpoint: terminalCheckpoint }, prefilter: prefilterReceipt, frontier: frontierReceipt, frontierGeneration: frontierGenerationReceipt, frontierTargetGeneration: frontierTargetGenerationReceipt, frontierTargetPool: frontierTargetPoolReceipt, frontierMetrics: frontierMetricsReceipt, fieldMetrics: fieldMetricsReceipt, frontierState: frontierStateReceipt, frontierTopology: frontierTopologyReceipt, frontierRanker: frontierRankerReceipt, frontierCompactor: frontierCompactorReceipt, frontierDedup: frontierDedupReceipt };
}

export { search };
