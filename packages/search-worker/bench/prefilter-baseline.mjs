import { performance } from 'node:perf_hooks';
import { cpuCandidatePrefilter } from '../../search-core/src/webgpu-candidate-prefilter.js';

const candidateCount = Number(process.argv[2] || 2048);
const candidates = Array.from({ length: candidateCount }, (_, index) => Array.from({ length: 15 }, (_, piece) => ({
  pieceId: piece + 1,
  cells: Array.from({ length: 9 }, (_, cell) => ({
    x: ((index * 17 + piece * 5 + cell) % 31) - 15,
    y: ((index * 11 + piece * 3 + cell * 2) % 31) - 15,
  })),
})));

const started = performance.now();
const result = cpuCandidatePrefilter(candidates);
const elapsedMs = performance.now() - started;
const cells = candidateCount * 15 * 9;

console.log(JSON.stringify({
  benchmark: 'cpu-prefilter-baseline',
  candidateCount,
  cells,
  elapsedMs: Number(elapsedMs.toFixed(3)),
  candidatesPerSecond: Math.round(candidateCount / Math.max(elapsedMs / 1000, Number.EPSILON)),
  accepted: result.acceptedIndices.length,
  backend: 'cpu-oracle',
  note: 'Use this fixture and batch shape for browser WebGPU parity/throughput comparison.',
}));
