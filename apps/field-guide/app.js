import { createDisplayGeometry } from '../../packages/domain/src/display-geometry.js';
import { createRendererRequest } from '../../packages/browser-handoff/src/renderer-boundary.js';
import { createCpuOracleFirstAdapter } from '../../packages/search-core/src/compute-adapter.js';
import { createWorkCursor } from '../../packages/search-core/src/work-cursor.js';

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
const ticket = Object.freeze({
  presetFingerprint: 'SEDLEC-00Q_ISLAND-001',
  familyId: 'F-0RHDG0U',
  pass: 0,
  threadId: 0,
});
const runSeed = 'tdotdh-v2-preview';
const oracleAdapter = createCpuOracleFirstAdapter({
  unavailableReason: 'WebGPU backend not exposed in preview',
  cpuOracle: async (request) => {
    const offset = request.cursor.nodeCursor % 5;
    const placements = cells.map(([x, y]) => ({ x: x + offset, y }));
    const canonicalCells = placements
      .map(({ x, y }) => `${x},${y}`)
      .sort()
      .join('|');
    return {
      canonicalSignature: `tdotdh.arrangement/v1:${canonicalCells}`,
      placements,
    };
  },
});

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

function renderArrangement(placements = cells.map(([x, y]) => ({ x, y }))) {
  document.querySelectorAll('.cell').forEach((cell) => {
    cell.classList.remove('filled', 'centroid');
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    if (placements.some((placement) => placement.x === x && placement.y === y)) cell.classList.add('filled');
    if (placements.some((placement) => placement.x === x && placement.y === y) && x === placements[8].x && y === placements[8].y) cell.classList.add('centroid');
  });
  const request = createRendererRequest({ geometry, cells: placements });
  signature.textContent = `tdotdh.arrangement/v1:${request.source.cells.map(({ x, y }) => `${x},${y}`).join('|')}`;
}

let runs = 0;
renderArrangement();
searchButton.addEventListener('click', async () => {
  runs += 1;
  searchButton.disabled = true;
  searchButton.textContent = 'Running CPU oracle…';
  const cursor = createWorkCursor(ticket, { runSeed, nodeCursor: runs });
  const result = await oracleAdapter.execute({ mode: 'depth', ticket, cursor, runSeed });
  renderArrangement(result.placements);
  count.textContent = String(runs + 1).padStart(2, '0');
  searchButton.disabled = false;
  searchButton.textContent = `CPU oracle complete · run ${runs}`;
});
