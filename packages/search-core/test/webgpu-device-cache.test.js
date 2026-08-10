import assert from 'node:assert/strict';
import { createWebGpuDeviceCache, WEBGPU_DEVICE_CACHE_SCHEMA } from '../src/webgpu-device-cache.js';

let adapterRequests = 0;
let deviceRequests = 0;
const devices = [{ id: 1 }, { id: 2 }];
const gpu = { requestAdapter: async () => { adapterRequests += 1; return { requestDevice: async () => { deviceRequests += 1; return devices[deviceRequests - 1]; } }; } };
const cache = createWebGpuDeviceCache({ gpu });
assert.equal(cache.schema, WEBGPU_DEVICE_CACHE_SCHEMA);
const first = await cache.getDevice();
const second = await cache.getDevice();
assert.equal(first, second);
assert.equal(adapterRequests, 1);
assert.equal(deviceRequests, 1);
cache.reset();
assert.equal(await cache.getDevice(), devices[1]);
assert.equal(adapterRequests, 2);
assert.equal(deviceRequests, 2);
console.log('WebGPU device cache tests passed');
