export const FRONTIER_BATCH_SCHEMA = 'tdotdh.frontier-batch.v0';
export const FRONTIER_BATCH_OPERATION = 'frontier-batch';
export const MAX_FRONTIER_CANDIDATES = 4096;
export const MAX_FRONTIER_CELLS = 1024;
export const MAX_FRONTIER_PLACEMENTS = 64;

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function integer(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
  return number;
}

function coordinate(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new TypeError(`${label} must be a safe integer`);
  return number;
}

function cells(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FRONTIER_CELLS) throw new TypeError(`${label} must contain 1-${MAX_FRONTIER_CELLS} cells`);
  return value.map((cell, index) => {
    const item = requireObject(cell, `${label}[${index}]`);
    return Object.freeze({ x: coordinate(item.x, `${label}[${index}].x`), y: coordinate(item.y, `${label}[${index}].y`) });
  });
}
function placements(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FRONTIER_PLACEMENTS) throw new TypeError(`${label} must contain 1-${MAX_FRONTIER_PLACEMENTS} placements`);
  return value.map((placement, index) => {
    const item = requireObject(placement, `${label}[${index}]`);
    return Object.freeze({ id: integer(item.id, `${label}[${index}].id`), cells: cells(item.cells, `${label}[${index}].cells`) });
  });
}

export function normalizeFrontierBatch(value) {
  const source = requireObject(value, 'frontierBatch');
  if (source.schema !== FRONTIER_BATCH_SCHEMA) throw new TypeError(`frontierBatch.schema must be ${FRONTIER_BATCH_SCHEMA}`);
  if (!Array.isArray(source.candidates) || source.candidates.length === 0 || source.candidates.length > MAX_FRONTIER_CANDIDATES) throw new TypeError(`frontierBatch.candidates must contain 1-${MAX_FRONTIER_CANDIDATES} candidates`);
  const ids = new Set();
  const candidates = source.candidates.map((candidate, index) => {
    const item = requireObject(candidate, `frontierBatch.candidates[${index}]`);
    const id = integer(item.id ?? index, `frontierBatch.candidates[${index}].id`);
    if (ids.has(id)) throw new TypeError(`frontierBatch candidate id ${id} is duplicated`);
    ids.add(id);
    return Object.freeze({
      id,
      depth: integer(item.depth ?? 0, `frontierBatch.candidates[${index}].depth`),
      parentCells: cells(item.parentCells, `frontierBatch.candidates[${index}].parentCells`),
      candidateCells: cells(item.candidateCells, `frontierBatch.candidates[${index}].candidateCells`),
      placements: placements(item.placements, `frontierBatch.candidates[${index}].placements`),
    });
  });
  return Object.freeze({ schema: FRONTIER_BATCH_SCHEMA, candidates: Object.freeze(candidates) });
}

export function createFrontierBatch(candidates) {
  return normalizeFrontierBatch({ schema: FRONTIER_BATCH_SCHEMA, candidates });
}

export function sliceFrontierBatch(batch, { nodeOffset = 0, maxNodes = MAX_FRONTIER_CANDIDATES } = {}) {
  const normalized = normalizeFrontierBatch(batch);
  const start = integer(nodeOffset, 'frontier cursor.nodeOffset');
  const limit = integer(maxNodes, 'frontier budget.maxNodes');
  if (limit < 1) throw new TypeError('frontier budget.maxNodes must be at least 1');
  const end = Math.min(normalized.candidates.length, start + limit);
  return Object.freeze({
    schema: FRONTIER_BATCH_SCHEMA,
    candidates: Object.freeze(normalized.candidates.slice(start, end)),
    start,
    end,
    complete: end >= normalized.candidates.length,
  });
}
