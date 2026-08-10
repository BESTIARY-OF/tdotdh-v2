import assert from 'node:assert/strict';
import { createWebGpuFrontierNavigationPlan, createWebGpuFrontierNavigationScheduler, cpuSelectFrontierNavigationRows, decodeWebGpuFrontierNavigationRow, WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA } from '../src/webgpu-frontier-navigation-plan.js';

const rows = [
  { planIndex: 0, targetOrdinal: 1, pieceId: 4, candidateIndex: 0, originX: 2, originY: 3, targetX: 2, targetY: 4 },
  { planIndex: 0, targetOrdinal: 1, pieceId: 5, candidateIndex: 0, originX: 3, originY: 3, targetX: 2, targetY: 4 },
  { planIndex: 0, targetOrdinal: 0, pieceId: 4, candidateIndex: 1, originX: 1, originY: 3, targetX: 1, targetY: 4 },
  { planIndex: 1, targetOrdinal: 0, pieceId: 7, candidateIndex: 0, originX: -1, originY: 2, targetX: -1, targetY: 3 },
];
const plan = createWebGpuFrontierNavigationPlan(rows);
assert.equal(plan.schema, WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA);
assert.equal(plan.rowCount, 4);
assert.equal(plan.stride, 8);
assert.ok(plan.values instanceof Int32Array);
assert.deepEqual(decodeWebGpuFrontierNavigationRow(plan, 2), rows[2]);
const oracle = cpuSelectFrontierNavigationRows(plan, { planCount: 2 });
assert.deepEqual(Array.from(oracle.selectedRows), [2, 3]);
const scheduler = createWebGpuFrontierNavigationScheduler({ accelerator: async ({ oracle: expected }) => ({ status: 'completed', selectedRows: expected.selectedRows, dispatch: 'fake-navigation-dispatch' }) });
const verified = await scheduler.select(rows, { planCount: 2 });
assert.equal(verified.backend, 'webgpu');
assert.equal(verified.parity, 'verified');
assert.equal(verified.dispatch, 'fake-navigation-dispatch');
const fallback = await createWebGpuFrontierNavigationScheduler().select(rows, { planCount: 2 });
assert.equal(fallback.backend, 'cpu-oracle');
assert.equal(fallback.parity, 'oracle');
console.log('WebGPU frontier navigation-plan tests passed');
