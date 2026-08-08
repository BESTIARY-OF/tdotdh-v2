const WORD_BITS = 32;
const FRAME_WIDTH = 32;

function assertCell(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= FRAME_WIDTH || y < 0 || y >= FRAME_WIDTH) {
    throw new RangeError(`cell outside ${FRAME_WIDTH}x${FRAME_WIDTH} frame: ${x},${y}`);
  }
}

export function createOccupancy() {
  return new Uint32Array(FRAME_WIDTH);
}

export function hasCell(words, x, y) {
  assertCell(x, y);
  return (words[y] & (1 << x)) !== 0;
}

export function setCell(words, x, y) {
  assertCell(x, y);
  words[y] |= 1 << x;
  return words;
}

export function intersects(words, rows, originX, originY) {
  if (!Number.isInteger(originX) || !Number.isInteger(originY)) throw new TypeError("origin must be integral");
  for (let row = 0; row < rows.length; row += 1) {
    const y = originY + row;
    if (y < 0 || y >= FRAME_WIDTH) throw new RangeError("candidate outside frame");
    const shifted = (rows[row] << originX) >>> 0;
    if ((words[y] & shifted) !== 0) return true;
  }
  return false;
}

export function placeRows(words, rows, originX, originY) {
  if (intersects(words, rows, originX, originY)) return false;
  for (let row = 0; row < rows.length; row += 1) {
    words[originY + row] |= (rows[row] << originX) >>> 0;
  }
  return true;
}

export function countCells(words) {
  let count = 0;
  for (const word of words) count += word.toString(2).replaceAll("0", "").length;
  return count;
}

export { FRAME_WIDTH, WORD_BITS };
