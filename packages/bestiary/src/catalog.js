const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

export function normalizeCells(cells = []) {
  if (!cells.length) return [];
  const minX = Math.min(...cells.map(cell => Number(cell.x)));
  const minY = Math.min(...cells.map(cell => Number(cell.y)));
  return cells
    .map(cell => ({ x: Number(cell.x) - minX, y: Number(cell.y) - minY }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function transformedCells(cells, transform) {
  return normalizeCells(cells.map(({ x, y }) => {
    switch (transform) {
      case 1: return { x: -y, y: x };
      case 2: return { x: -x, y: -y };
      case 3: return { x: y, y: -x };
      case 4: return { x: -x, y };
      case 5: return { x, y: -y };
      case 6: return { x: y, y: x };
      case 7: return { x: -y, y: -x };
      default: return { x, y };
    }
  }));
}

export function canonicalPolyomino(cells = []) {
  return Array.from({ length: 8 }, (_, transform) => transformedCells(cells, transform)
    .map(cellKey)
    .join(';')).sort()[0] || '';
}

/**
 * A stable, collision-free identity for a canonical shape. The encoded
 * signature is intentionally invertible: identity does not depend on the
 * algoset, batch, machine, or discovery order.
 */
export function polyominoGuid(cellsOrCanonical = []) {
  const canonical = typeof cellsOrCanonical === 'string' ? cellsOrCanonical : canonicalPolyomino(cellsOrCanonical);
  const encoded = Array.from(canonical, character => character.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return `S-${encoded || 'EMPTY'}`;
}

function growthCandidates(cells, maxWidth, maxHeight) {
  const occupied = new Set(cells.map(cellKey));
  const bounds = {
    minX: Math.min(...cells.map(cell => cell.x)),
    maxX: Math.max(...cells.map(cell => cell.x)),
    minY: Math.min(...cells.map(cell => cell.y)),
    maxY: Math.max(...cells.map(cell => cell.y)),
  };
  const candidates = [];
  for (const cell of cells) {
    for (const [dx, dy] of DIRECTIONS) {
      const candidate = { x: cell.x + dx, y: cell.y + dy };
      if (occupied.has(cellKey(candidate))) continue;
      const nextMinX = Math.min(bounds.minX, candidate.x);
      const nextMaxX = Math.max(bounds.maxX, candidate.x);
      const nextMinY = Math.min(bounds.minY, candidate.y);
      const nextMaxY = Math.max(bounds.maxY, candidate.y);
      if (nextMaxX - nextMinX + 1 > maxWidth || nextMaxY - nextMinY + 1 > maxHeight) continue;
      candidates.push(candidate);
    }
  }
  return candidates;
}

export function analyzePolyomino(cells = []) {
  const normalized = normalizeCells(cells);
  const occupied = new Set(normalized.map(cellKey));
  const width = normalized.length ? Math.max(...normalized.map(cell => cell.x)) + 1 : 0;
  const height = normalized.length ? Math.max(...normalized.map(cell => cell.y)) + 1 : 0;
  let perimeter = 0;
  for (const cell of normalized) {
    for (const [dx, dy] of DIRECTIONS) if (!occupied.has(`${cell.x + dx},${cell.y + dy}`)) perimeter++;
  }
  return { area: normalized.length, width, height, perimeter, density: width && height ? normalized.length / (width * height) : 0 };
}

/**
 * Enumerate free polyominoes in deterministic canonical order. The default
 * limit intentionally matches the historical browser's 100-shape catalog,
 * while callers can request a smaller preview or a larger offline catalog.
 */
export function enumeratePolyominoes(area, { limit = 100, offset = 0, maxWidth = 20, maxHeight = 20 } = {}) {
  const targetArea = Math.max(1, Math.floor(Number(area) || 1));
  const startAt = Math.max(0, Math.floor(Number(offset) || 0));
  const shapes = [];
  const seen = new Set();
  const visit = cells => {
    if (shapes.length >= limit) return;
    if (cells.length === targetArea) {
      const normalized = normalizeCells(cells);
      const canonical = canonicalPolyomino(normalized);
      if (seen.has(canonical)) return;
      seen.add(canonical);
      if (seen.size <= startAt) return;
      shapes.push({ ordinal: startAt + shapes.length + 1, cells: normalized, canonical, guid: polyominoGuid(canonical), metrics: analyzePolyomino(normalized) });
      return;
    }
    for (const candidate of growthCandidates(cells, maxWidth, maxHeight)) {
      visit([...cells, candidate]);
      if (shapes.length >= limit) return;
    }
  };
  visit([{ x: 0, y: 0 }]);
  return shapes;
}

export function mobPlacementSequence({ yang = 0, yin = 0, strategy = 'yang-first' } = {}) {
  const sequence = [];
  if (strategy === 'yin-first') {
    for (let index = 0; index < yin; index++) sequence.push('yin');
    for (let index = 0; index < yang; index++) sequence.push('yang');
    return sequence;
  }
  if (strategy === 'turn-taking') {
    let yangLeft = yang;
    let yinLeft = yin;
    while (yangLeft || yinLeft) {
      if (yangLeft) { sequence.push('yang'); yangLeft--; }
      if (yinLeft) { sequence.push('yin'); yinLeft--; }
    }
    return sequence;
  }
  for (let index = 0; index < yang; index++) sequence.push('yang');
  for (let index = 0; index < yin; index++) sequence.push('yin');
  return sequence;
}

function occupancy(placements, key) {
  return placements.filter(placement => cellKey(placement.cell) === key)
    .reduce((total, placement) => total + (placement.mobType === 'yang' ? 1 : 0.5), 0);
}

export function enumerateMobPlacements(cells, { yang = 0, yin = 0, strategy = 'yang-first', limit = 256 } = {}) {
  const shapeCells = normalizeCells(cells);
  const shapeKeys = new Set(shapeCells.map(cellKey));
  const sequence = mobPlacementSequence({ yang: Math.max(0, Math.floor(Number(yang) || 0)), yin: Math.max(0, Math.floor(Number(yin) || 0)), strategy });
  const placements = [];
  let truncated = false;
  const visit = (index, current) => {
    if (placements.length >= limit) { truncated = true; return; }
    if (index >= sequence.length) {
      const totalArea = current.reduce((total, placement) => total + (placement.mobType === 'yang' ? 1 : 0.5), 0);
      if (Math.abs(totalArea - shapeCells.length) < 1e-9) placements.push(current.map(placement => ({ ...placement, cell: { ...placement.cell } })));
      return;
    }
    const mobType = sequence[index];
    for (const cell of shapeCells) {
      const key = cellKey(cell);
      const used = occupancy(current, key);
      if (mobType === 'yang') {
        if (used > 0) continue;
        visit(index + 1, [...current, { mobType: 'yang', area: 1, cell: { ...cell } }]);
      } else {
        if (used >= 1) continue;
        if (used === 0) {
          for (let orientation = 0; orientation < 4; orientation++) {
            visit(index + 1, [...current, { mobType: 'yin', area: 0.5, cell: { ...cell }, orientation }]);
            if (placements.length >= limit) return;
          }
        } else if (used === 0.5) {
          const existing = current.find(placement => placement.mobType === 'yin' && cellKey(placement.cell) === key);
          visit(index + 1, [...current, { mobType: 'yin', area: 0.5, cell: { ...cell }, orientation: ((existing?.orientation || 0) + 2) % 4 }]);
        }
      }
      if (placements.length >= limit) return;
    }
  };
  if (shapeCells.length && sequence.length && sequence.reduce((total, type) => total + (type === 'yang' ? 1 : 0.5), 0) <= shapeCells.length) visit(0, []);
  if (placements.length >= limit) truncated = true;
  return { placements, truncated, sequence, shapeArea: shapeCells.length };
}

export function createCatalogRecord(shape, { area = shape.metrics?.area || shape.cells.length, profile = {}, source = 'generated' } = {}) {
  const metrics = shape.metrics || analyzePolyomino(shape.cells);
  return {
    id: String(shape.id || `P-${area}-${shape.ordinal}`),
    guid: shape.guid || polyominoGuid(shape.canonical || shape.cells),
    ordinal: Number(shape.ordinal || 0),
    area: Number(area),
    cells: normalizeCells(shape.cells),
    canonical: shape.canonical || canonicalPolyomino(shape.cells),
    metrics,
    profile: {
      yang: Number(profile.yang || 0),
      yin: Number(profile.yin || 0),
      strategy: profile.strategy || 'yang-first',
      placementCount: Number(profile.placementCount || 0),
      placementTruncated: Boolean(profile.placementTruncated),
    },
    source,
  };
}

export const BESTIARY_VERSION = 'tdotdh-bestiary-v1';
