import { readFile } from 'node:fs/promises';
import { search } from '../../../apps/field-guide/product/v2-legacy-search.js';
import { cpuEvaluateFrontierMetrics } from '../../../packages/search-core/src/webgpu-frontier-metrics.js';
import { cpuTransitionLabeledFrontierStates } from '../../../packages/search-core/src/webgpu-labeled-frontier-state.js';
import { cpuFrontierTopology } from '../../../packages/search-core/src/webgpu-frontier-topology.js';

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

function createBenchFrontierMetrics() {
  const receipt = { batches: 0, candidates: 0 };
  return {
    receipt,
    evaluate: async candidates => {
      receipt.batches += 1;
      receipt.candidates += candidates.length;
      const result = cpuEvaluateFrontierMetrics(candidates);
      return { ...result, backend: 'benchmark', parity: 'verified' };
    },
  };
}

function createBenchFrontierState() {
  const receipt = { batches: 0, candidates: 0 };
  return {
    receipt,
    transition: async candidates => {
      receipt.batches += 1;
      receipt.candidates += candidates.length;
      const result = cpuTransitionLabeledFrontierStates(candidates);
      return { ...result, backend: 'benchmark', parity: 'verified' };
    },
  };
}

function createBenchFrontierTopology() {
  const receipt = { evaluations: 0 };
  return {
    receipt,
    evaluate: async input => {
      receipt.evaluations += 1;
      return { ...cpuFrontierTopology(input), backend: 'benchmark', parity: 'verified' };
    },
  };
}

async function run(mode, options = {}) {
  const candidatePrefilter = createBenchPrefilter();
  const frontierMetrics = createBenchFrontierMetrics();
  const frontierState = createBenchFrontierState();
  const frontierTopology = createBenchFrontierTopology();
  const started = performance.now();
  const result = await search(pieces, [], { searchStrategy: mode, candidatePrefilter, frontierMetrics, frontierState, frontierTopology, ...options });
  return {
    mode,
    elapsedMs: Number((performance.now() - started).toFixed(2)),
    nodes: result.nodes,
    placements: Boolean(result.placements),
    prefilter: result.prefilter,
    ...candidatePrefilter.receipt,
    frontierMetrics: frontierMetrics.receipt,
    frontierState: frontierState.receipt,
    frontierTopology: frontierTopology.receipt,
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
