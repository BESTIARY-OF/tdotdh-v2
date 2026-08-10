import { readFile } from 'node:fs/promises';
import { search } from '../../../apps/field-guide/product/v2-legacy-search.js';

globalThis.postMessage = () => {};

const productSource = await readFile(new URL('../../../apps/field-guide/product/app.js', import.meta.url), 'utf8');
const shapesLiteral = productSource.match(/const SOURCE_SHAPES = (\{[\s\S]*?\n\});/)?.[1];
if (!shapesLiteral) throw new Error('product SOURCE_SHAPES fixture not found');
const shapes = Function(`return ${shapesLiteral}`)();
const ids = [49, 43, 13, 26, 3, 4, 97, 9, 1, 21, 2, 6, 8, 24, 40];
const locks = { 8: 'flip-x', 40: 'flip-xy', 43: 'flip-x' };
const pieces = ids.map(id => ({ id, cells: shapes[id].map(([x, y]) => ({ x, y })), orientation: locks[id] || 'fixed' }));

function createBenchPrefilter() {
  const receipt = { batches: 0, candidates: 0 };
  return {
    receipt,
    prefilter: async candidates => {
      receipt.batches += 1;
      receipt.candidates += candidates.length;
      return { status: 'completed', backend: 'benchmark', validity: candidates.map(() => 1) };
    },
  };
}

async function run(mode, options = {}) {
  const candidatePrefilter = createBenchPrefilter();
  const started = performance.now();
  const result = await search(pieces, [], { searchStrategy: mode, candidatePrefilter, ...options });
  return {
    mode,
    elapsedMs: Number((performance.now() - started).toFixed(2)),
    nodes: result.nodes,
    placements: Boolean(result.placements),
    prefilter: result.prefilter,
    ...candidatePrefilter.receipt,
    result,
  };
}

const breadth = await run('breadth');
const depth = await run('depth');
const target = await run('balanced', {
  targetFamily: breadth.result.metrics?.centroidFamilyId || null,
  targetSeed: breadth.result.metrics?.centroidSeed || null,
  searchSalt: 'product-search-receipt-target',
});

console.log(JSON.stringify({
  fixture: 'SEDLEC-00Q_ISLAND-001 source shapes',
  breadth: { ...breadth, result: undefined },
  depth: { ...depth, result: undefined },
  targetFamily: { ...target, result: undefined },
}, null, 2));
