export const WEBGPU_FRONTIER_BATCH_LAYOUT_SCHEMA = 'tdotdh.webgpu-frontier-batch-layout.v0';

function inGrid(x, y, grid) {
  return x >= grid.originX && x < grid.originX + grid.width && y >= grid.originY && y < grid.originY + grid.height;
}

function encodeCells(cells) {
  const values = new Int32Array(cells.length * 2);
  for (let index = 0; index < cells.length; index += 1) {
    values[index * 2] = cells[index].x;
    values[index * 2 + 1] = cells[index].y;
  }
  return values;
}

function flattenCells(items, property, caches = null) {
  const offsets = [];
  let offset = 0;
  for (const item of items) {
    offsets.push(offset);
    offset += item[property].length * 2;
  }
  const values = new Int32Array(offset);
  let writeOffset = 0;
  for (const item of items) {
    const cells = item[property];
    const cached = caches?.cells?.get(cells);
    const encoded = cached || encodeCells(cells);
    if (!cached) caches?.cells?.set(cells, encoded);
    values.set(encoded, writeOffset);
    writeOffset += encoded.length;
  }
  // The shader indexes flattened coordinate pairs, so offsets are measured
  // in i32 values rather than logical cells.
  return { offsets: Object.freeze(offsets), values };
}

function createMask(cells, grid) {
  const mask = new Uint32Array(grid.wordCount);
  for (const cell of cells || []) {
    if (!inGrid(cell.x, cell.y, grid)) continue;
    const bit = (cell.y - grid.originY) * grid.width + (cell.x - grid.originX);
    mask[Math.floor(bit / 32)] |= 1 << (bit % 32);
  }
  return mask;
}

function flattenMasks(items, grid, caches = null) {
  const flat = new Uint32Array(items.length * grid.wordCount);
  items.forEach((item, index) => {
    const cached = caches?.masks?.get(item.fieldCells);
    const mask = cached || createMask(item.fieldCells, grid);
    if (!cached) caches?.masks?.set(item.fieldCells, mask);
    flat.set(mask, index * grid.wordCount);
  });
  return flat;
}

/**
 * Converts a beam batch into the stable struct-of-arrays layout shared by
 * frontier navigation kernels. JavaScript objects stay on the orchestration
 * side; GPU stages consume these typed arrays and preserve item order through
 * candidateOffset and the per-item metadata rows.
 */
export function createWebGpuFrontierBatchLayout(items, grid, caches = null) {
  if (!Array.isArray(items) || items.length === 0) throw new TypeError('frontier batch layout items must be non-empty');
  if (!grid || !Number.isSafeInteger(grid.width) || !Number.isSafeInteger(grid.height) || !Number.isSafeInteger(grid.wordCount)) throw new TypeError('frontier batch layout grid is invalid');
  const targets = flattenCells(items, 'targetCells', caches);
  const pieces = flattenCells(items, 'pieceCells', caches);
  const fieldMasks = flattenMasks(items, grid, caches);
  const metas = [];
  items.forEach((item, index) => {
    const lock = item.lock || { enabled: 0, x: 0, y: 0 };
    metas.push(
      item.targetCells.length,
      targets.offsets[index],
      pieces.offsets[index],
      item.pieceCells.length,
      index * grid.wordCount,
      item.candidateOffset,
      item.bounds.minX,
      item.bounds.maxX,
      item.bounds.minY,
      item.bounds.maxY,
      lock.x,
      lock.y,
      lock.enabled,
      0,
      0,
      0,
    );
  });
  return Object.freeze({
    schema: WEBGPU_FRONTIER_BATCH_LAYOUT_SCHEMA,
    itemCount: items.length,
    candidateCount: items.reduce((sum, item) => sum + item.candidateCount, 0),
    targetValues: targets.values,
    targetOffsets: targets.offsets,
    pieceValues: pieces.values,
    pieceOffsets: pieces.offsets,
    fieldMasks,
    metaValues: Int32Array.from(metas),
  });
}
