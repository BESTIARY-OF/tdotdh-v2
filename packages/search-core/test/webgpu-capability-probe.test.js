import assert from 'node:assert/strict';
import {
  probeWebGpuCapabilities,
  WEBGPU_CAPABILITY_PROBE_SCHEMA,
} from '../src/webgpu-capability-probe.js';

const requiredLimits = {
  maxStorageBufferBindingSize: 65536,
  maxComputeInvocationsPerWorkgroup: 64,
};

assert.deepEqual(
  await probeWebGpuCapabilities({ gpu: null, requiredLimits }),
  {
    schema: WEBGPU_CAPABILITY_PROBE_SCHEMA,
    adapterAvailable: false,
    requiredLimits,
    requiredLimitsSatisfied: null,
  },
);

let adapterRequests = 0;
let deviceRequests = 0;
const available = await probeWebGpuCapabilities({
  gpu: {
    requestAdapter: async () => {
      adapterRequests += 1;
      return {
        limits: {
          maxStorageBufferBindingSize: 131072,
          maxComputeInvocationsPerWorkgroup: 128,
        },
        requestDevice: async () => {
          deviceRequests += 1;
          throw new Error('the probe must not request a device');
        },
      };
    },
  },
  requiredLimits,
});
assert.deepEqual(available, {
  schema: WEBGPU_CAPABILITY_PROBE_SCHEMA,
  adapterAvailable: true,
  requiredLimits,
  requiredLimitsSatisfied: true,
});
assert.equal(adapterRequests, 1);
assert.equal(deviceRequests, 0);

const insufficient = await probeWebGpuCapabilities({
  gpu: { requestAdapter: async () => ({ limits: { maxStorageBufferBindingSize: 65536, maxComputeInvocationsPerWorkgroup: 32 } }) },
  requiredLimits,
});
assert.equal(insufficient.adapterAvailable, true);
assert.equal(insufficient.requiredLimitsSatisfied, false);

const rejected = await probeWebGpuCapabilities({
  gpu: { requestAdapter: async () => { throw new Error('adapter request rejected'); } },
  requiredLimits: {},
});
assert.equal(rejected.adapterAvailable, false);
assert.equal(rejected.requiredLimitsSatisfied, null);

await assert.rejects(() => probeWebGpuCapabilities({ gpu: null, requiredLimits: { maxBufferSize: -1 } }), /non-negative safe integer/);
await assert.rejects(() => probeWebGpuCapabilities({ gpu: null, requiredLimits: { maxBufferSize: 1.5 } }), /non-negative safe integer/);

console.log('WebGPU capability probe tests passed');
