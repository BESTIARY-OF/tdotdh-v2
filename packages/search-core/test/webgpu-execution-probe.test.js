import assert from 'node:assert/strict';
import {
  probeWebGpuExecutionCapabilities,
  WEBGPU_EXECUTION_PROBE_SCHEMA,
} from '../src/webgpu-execution-probe.js';

const unavailable = await probeWebGpuExecutionCapabilities({ gpu: null, requiredLimits: { maxStorageBufferBindingSize: 65536 } });
assert.deepEqual(unavailable, {
  schema: WEBGPU_EXECUTION_PROBE_SCHEMA,
  adapterAvailable: false,
  deviceAvailable: false,
  requiredLimits: { maxStorageBufferBindingSize: 65536 },
  requiredLimitsSatisfied: null,
  reason: 'webgpu-adapter-unavailable',
});

let deviceRequests = 0;
const device = { label: 'fake-device' };
const cache = {
  async getDevice() { deviceRequests += 1; return device; },
  reset() { throw new Error('reset must not run for an available device'); },
};
const available = await probeWebGpuExecutionCapabilities({
  gpu: { requestAdapter: async () => ({ limits: { maxStorageBufferBindingSize: 131072 }, requestDevice: async () => device }) },
  requiredLimits: { maxStorageBufferBindingSize: 65536 },
  deviceCache: cache,
});
assert.deepEqual(available, {
  schema: WEBGPU_EXECUTION_PROBE_SCHEMA,
  adapterAvailable: true,
  deviceAvailable: true,
  requiredLimits: { maxStorageBufferBindingSize: 65536 },
  requiredLimitsSatisfied: true,
});
assert.equal(deviceRequests, 1);

let resets = 0;
const rejected = await probeWebGpuExecutionCapabilities({
  gpu: { requestAdapter: async () => ({ limits: { maxStorageBufferBindingSize: 131072 }, requestDevice: async () => { throw new Error('device denied'); } }) },
  requiredLimits: { maxStorageBufferBindingSize: 65536 },
  deviceCache: {
    async getDevice() { throw new Error('device denied'); },
    reset() { resets += 1; },
  },
});
assert.equal(rejected.schema, WEBGPU_EXECUTION_PROBE_SCHEMA);
assert.equal(rejected.deviceAvailable, false);
assert.equal(rejected.reason, 'webgpu-device-request-failed:device denied');
assert.equal(resets, 1);

console.log('WebGPU execution probe tests passed');
