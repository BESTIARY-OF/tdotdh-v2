import assert from 'node:assert/strict';
import { createFieldMetricsCandidate, cpuEvaluateFieldMetrics, createWebGpuFieldMetrics, WEBGPU_FIELD_METRICS_SCHEMA } from '../src/webgpu-field-metrics.js';

const occupiedCells = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
  { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
];
const centroidCells = [{ x: 1, y: 0 }];
const candidate = createFieldMetricsCandidate({ occupiedCells, centroidCells });
const cpu = cpuEvaluateFieldMetrics([candidate]);
assert.equal(cpu.schema, WEBGPU_FIELD_METRICS_SCHEMA);
assert.deepEqual(cpu.metrics[0].slice(0, 15), [6, 10, 0, 2, 0, 1, 6, 3, 1, 1, 0, 1, 1, 0, 0]);
assert.deepEqual(cpuEvaluateFieldMetrics([{ occupiedMask: candidate.occupiedMask, centroidMask: candidate.centroidMask }]).metrics, cpu.metrics);
const empty = { occupiedMask: new Uint32Array(candidate.occupiedMask.length), centroidMask: new Uint32Array(candidate.centroidMask.length), outsideMask: new Uint32Array(candidate.outsideMask.length) };
assert.deepEqual(cpuEvaluateFieldMetrics([empty]).metrics[0].slice(0, 6), [0, 0, 0, 0, 0, 0]);

const ringCells = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
  { x: 0, y: 1 }, { x: 2, y: 1 },
  { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
];
assert.deepEqual(cpuEvaluateFieldMetrics([createFieldMetricsCandidate({ occupiedCells: ringCells })]).metrics[0].slice(13, 15), [1, 4]);

const unavailable = createWebGpuFieldMetrics({ gpu: null });
const result = await unavailable.evaluate([candidate]);
assert.equal(result.status, 'unavailable');
assert.deepEqual(result.metrics, cpu.metrics);
assert.equal(result.parity, 'oracle');
console.log('WebGPU field metrics tests passed');
