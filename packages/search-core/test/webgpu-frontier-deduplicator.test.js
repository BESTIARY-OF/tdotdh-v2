import assert from 'node:assert/strict';
import { cpuDeduplicateFrontierStates, createWebGpuFrontierDeduplicator, DEFAULT_SHADER, WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA } from '../src/webgpu-frontier-deduplicator.js';

assert.match(DEFAULT_SHADER, /var<storage, read> hashes/);
assert.match(DEFAULT_SHADER, /hashes\[previous\] == hashes\[index\]/);

const rows = [
  { hash: 11, signature: 'a' },
  { hash: 11, signature: 'b' },
  { hash: 11, signature: 'a' },
  { hash: 12, signature: 'c' },
];
const cpu = cpuDeduplicateFrontierStates(rows);
assert.equal(cpu.schema, WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA);
assert.deepEqual(cpu.keep, [1, 1, 0, 1]);
const fallback = await createWebGpuFrontierDeduplicator({ gpu: null }).deduplicate(rows);
assert.equal(fallback.status, 'unavailable');
assert.deepEqual(fallback.keep, cpu.keep);
assert.throws(() => cpuDeduplicateFrontierStates([{ hash: 1, signature: '' }]), /non-empty string/);
console.log('WebGPU frontier deduplicator tests passed');
