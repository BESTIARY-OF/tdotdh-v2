import { createDisplayGeometry } from '../../packages/domain/src/display-geometry.js';
import { createRendererRequest } from '../../packages/browser-handoff/src/renderer-boundary.js';

const geometry = createDisplayGeometry({ kind: 'flatland', dimension: 2 });
const cells = [
  [2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3], [5, 3],
  [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [3, 5], [4, 5], [5, 5],
];

const field = document.querySelector('#field');
const signature = document.querySelector('#signature');
const count = document.querySelector('#arrangement-count');
const searchButton = document.querySelector('#search-button');
const targets = document.querySelector('#targets');
const targetNames = ['flatland', 'sphere', 'hypersphere', 'cube', 'hypercube', 'simplex'];

for (let y = 0; y < 15; y += 1) {
  for (let x = 0; x < 16; x += 1) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.x = x;
    cell.dataset.y = y;
    field.append(cell);
  }
}

for (const target of targetNames) {
  const chip = document.createElement('span');
  chip.className = 'target';
  chip.textContent = target === 'flatland' ? 'flatland · active' : `${target} · metadata-only`;
  targets.append(chip);
}

function renderArrangement(offset = 0) {
  document.querySelectorAll('.cell').forEach((cell) => {
    cell.classList.remove('filled', 'centroid');
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    if (cells.some(([cellX, cellY]) => cellX + offset === x && cellY === y)) cell.classList.add('filled');
    if (x === 4 + offset && y === 4) cell.classList.add('centroid');
  });
  const request = createRendererRequest({ geometry, cells: cells.map(([x, y]) => ({ x: x + offset, y })) });
  signature.textContent = `tdotdh.arrangement/v1:${request.source.cells.map(({ x, y }) => `${x},${y}`).join('|')}`;
}

let runs = 0;
renderArrangement();
searchButton.addEventListener('click', () => {
  runs += 1;
  renderArrangement(runs % 5);
  count.textContent = String(runs + 1).padStart(2, '0');
  searchButton.textContent = `CPU sample complete · run ${runs}`;
});
