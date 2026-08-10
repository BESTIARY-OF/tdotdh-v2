import assert from 'node:assert/strict';
import { createFrontierMetricsCandidate, cpuEvaluateFrontierMetrics, createWebGpuFrontierMetrics, WEBGPU_FRONTIER_METRICS_SCHEMA } from '../src/webgpu-frontier-metrics.js';

const parentCells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
const candidateCells = [{ x: 1, y: 1 }, { x: 2, y: 1 }];
const centroidCells = [{ x: 0, y: 0 }];
const ringCells = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
const bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
const candidate = createFrontierMetricsCandidate({ parentCells, candidateCells, centroidCells, ringCells, bounds });
const cpu = cpuEvaluateFrontierMetrics([candidate]);

assert.equal(cpu.schema, WEBGPU_FRONTIER_METRICS_SCHEMA);
assert.deepEqual(cpu.metrics[0], [2, 1, 0, 2, 3 * 2, 2 * 40000 + 6 * 1000 - 2 * 2400 - 1 * 2000]);

const unavailable = await createWebGpuFrontierMetrics({ gpu: null }).evaluate([candidate]);
assert.equal(unavailable.status, 'unavailable');
assert.deepEqual(unavailable.metrics, cpu.metrics);

console.log(JSON.stringify({ schema: cpu.schema, metrics: cpu.metrics, fallback: unavailable.reason }));
