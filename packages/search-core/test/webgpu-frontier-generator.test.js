import assert from 'node:assert/strict';
import { cpuGenerateFrontierCandidates, cpuGenerateFrontierBatch, createWebGpuFrontierGenerator, COMPACTION_SCAN_SHADER, COMPACTION_WRITE_SHADER } from '../src/webgpu-frontier-generator.js';

assert.match(COMPACTION_SCAN_SHADER, /workgroupBarrier/);
assert.match(COMPACTION_SCAN_SHADER, /groupTotals/);
assert.match(COMPACTION_WRITE_SHADER, /groupOffsets/);
assert.match(COMPACTION_WRITE_SHADER, /prefixes/);

const input = {
  fieldCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  pieceCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  bounds: { minX: 0, maxX: 1, minY: 0, maxY: 0 },
};
const cpu = cpuGenerateFrontierCandidates(input);
assert.equal(cpu.schema, 'tdotdh.webgpu-frontier-generator.v0');
assert.equal(cpu.candidateCount, 16);
assert.equal(cpu.origins.length, cpu.candidateCount);
assert.equal(cpu.validity.length, cpu.candidateCount);
assert.ok(cpu.acceptedIndices.length > 0);
assert.deepEqual(cpu, cpuGenerateFrontierCandidates(input));

const fallback = await createWebGpuFrontierGenerator({ gpu: null }).generate(input);
assert.equal(fallback.status, 'unavailable');
assert.deepEqual(fallback.origins, cpu.origins);
assert.deepEqual(fallback.validity, cpu.validity);
assert.deepEqual(fallback.acceptedIndices, cpu.acceptedIndices);
assert.deepEqual(fallback.compactedOrigins, cpu.compactedOrigins);
assert.equal(fallback.compactedCount, cpu.compactedCount);
const batchInput = [{ ...input, pieceId: 1 }, { ...input, pieceId: 2, pieceCells: [{ x: 0, y: 0 }] }];
const batchCpu = cpuGenerateFrontierBatch(batchInput);
assert.equal(batchCpu.candidateCount, 24);
assert.deepEqual(batchCpu.items.map(item => item.pieceId), [1, 2]);
assert.deepEqual(batchCpu.items.map(item => item.acceptedIndices.length), [10, 6]);
const batchFallback = await createWebGpuFrontierGenerator({ gpu: null }).generateBatch(batchInput);
assert.equal(batchFallback.status, 'unavailable');
assert.deepEqual(batchFallback.items.map(item => item.validity), batchCpu.items.map(item => item.validity));
console.log(JSON.stringify({ candidateCount: cpu.candidateCount, accepted: cpu.acceptedIndices.length, result: 'passed' }));
