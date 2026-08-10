import { readFile } from 'node:fs/promises';
import { search } from '../../../apps/field-guide/product/v2-legacy-search.js';
import { cpuEvaluateFrontierMetrics } from '../../../packages/search-core/src/webgpu-frontier-metrics.js';
import { cpuEvaluateFieldMetrics } from '../../../packages/search-core/src/webgpu-field-metrics.js';
import { cpuTransitionLabeledFrontierStates } from '../../../packages/search-core/src/webgpu-labeled-frontier-state.js';
import { cpuFrontierTopology } from '../../../packages/search-core/src/webgpu-frontier-topology.js';
import { cpuGenerateFrontierTargetBatch } from '../../../packages/search-core/src/webgpu-frontier-target-generator.js';
import { cpuGenerateFrontierTargetPoolBatch } from '../../../packages/search-core/src/webgpu-frontier-target-pool.js';

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

function createBenchFrontierTargetGenerator() {
  const receipt = { batches: 0, candidates: 0 };
  return {
    receipt,
    availability: async () => ({ status: 'available', backend: 'benchmark' }),
    generateBatch: async inputs => {
      receipt.batches += 1;
      const result = cpuGenerateFrontierTargetBatch(inputs);
      receipt.candidates += result.candidateCount;
      return { ...result, backend: 'benchmark', parity: 'verified' };
    },
  };
}

function createBenchFrontierTargetPool() {
  const receipt = { batches: 0, states: 0, cells: 0 };
  return {
    receipt,
    availability: async () => ({ status: 'available', backend: 'benchmark' }),
    generateBatch: async inputs => {
      receipt.batches += 1;
      receipt.states += inputs.length;
      const result = cpuGenerateFrontierTargetPoolBatch(inputs);
      receipt.cells += result.items.reduce((sum, item) => sum + item.frontierCells.length + item.ringCells.length, 0);
      return { ...result, backend: 'benchmark', parity: 'verified' };
    },
  };
}

function createBenchFieldMetrics() {
  const receipt = { batches: 0, candidates: 0 };
  return {
    receipt,
    availability: async () => ({ status: 'available', backend: 'benchmark', grid: { width: 64, height: 64, originX: -32, originY: -32 } }),
    evaluate: async candidates => {
      receipt.batches += 1;
      receipt.candidates += candidates.length;
      const result = cpuEvaluateFieldMetrics(candidates);
      return { ...result, backend: 'benchmark', parity: 'verified' };
    },
  };
}

function createBenchFrontierTopology() {
  const receipt = { evaluations: 0 };
  return {
    receipt,
    availability: async () => ({ status: 'fallback', backend: 'benchmark', reason: 'batch-path-not-measured' }),
    evaluateBatch: async inputs => ({ status: 'fallback', backend: 'benchmark', reason: 'batch-path-not-measured', candidateCount: inputs.length, results: [] }),
    evaluate: async input => {
      receipt.evaluations += 1;
      return { ...cpuFrontierTopology(input), backend: 'benchmark', parity: 'verified' };
    },
  };
}

async function run(mode, options = {}) {
  const candidatePrefilter = createBenchPrefilter();
  const frontierMetrics = createBenchFrontierMetrics();
  const fieldMetrics = createBenchFieldMetrics();
  const frontierState = createBenchFrontierState();
  const frontierTargetGenerator = createBenchFrontierTargetGenerator();
  const frontierTargetPool = createBenchFrontierTargetPool();
  const frontierTopology = createBenchFrontierTopology();
  const started = performance.now();
  const result = await search(pieces, [], { searchStrategy: mode, candidatePrefilter, frontierMetrics, fieldMetrics, frontierState, frontierTargetGenerator, frontierTargetPool, frontierTopology, ...options });
  return {
    mode,
    elapsedMs: Number((performance.now() - started).toFixed(2)),
    nodes: result.nodes,
    placements: Boolean(result.placements),
    prefilter: result.prefilter,
    ...candidatePrefilter.receipt,
    frontierMetrics: frontierMetrics.receipt,
    fieldMetrics: fieldMetrics.receipt,
    frontierState: frontierState.receipt,
    frontierTargetGeneration: frontierTargetGenerator.receipt,
    frontierTargetPool: frontierTargetPool.receipt,
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
