import assert from 'node:assert/strict';
import { search } from '../product/v2-legacy-search.js';
import { cpuGenerateFrontierTargetBatch } from '../../../packages/search-core/src/webgpu-frontier-target-generator.js';
import { cpuGenerateFrontierTargetPoolBatch } from '../../../packages/search-core/src/webgpu-frontier-target-pool.js';

globalThis.postMessage = () => {};

const cells = Array.from({ length: 9 }, (_, index) => ({ x: index % 3, y: Math.floor(index / 3) }));
const pieces = [{ id: 3, cells }, { id: 1, cells }];
let targetPoolCalls = 0;
const frontierTargetGenerator = {
  availability: async () => ({ status: 'available', backend: 'webgpu' }),
  generateBatch: async inputs => ({ ...cpuGenerateFrontierTargetBatch(inputs), status: 'completed', backend: 'test-target-generator', parity: 'verified' }),
};
const frontierTargetPool = {
  availability: async () => ({ status: 'available', backend: 'webgpu' }),
  generateBatch: async inputs => {
    targetPoolCalls += 1;
    return { ...cpuGenerateFrontierTargetPoolBatch(inputs), status: 'completed', backend: 'test-target-pool', parity: 'verified' };
  },
};

const result = await search(pieces, [], {
  searchStrategy: 'breadth',
  gpuExecution: { deviceAvailable: true },
  frontierTargetGenerator,
  frontierTargetPool,
  skipRedundantGpuTargetPool: true,
});

assert.equal(result.frontierTargetPool.status, 'skipped');
assert.equal(result.frontierTargetPool.backend, 'cpu-control');
assert.equal(result.frontierTargetPool.reason, 'redundant-with-gpu-target-generation-input');
assert.equal(targetPoolCalls, 0);
assert.equal(result.frontierTargetGeneration.backend, 'test-target-generator');
console.log('v2 target-pool control-plane test passed');
