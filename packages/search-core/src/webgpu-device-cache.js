export const WEBGPU_DEVICE_CACHE_SCHEMA = 'tdotdh.webgpu-device-cache.v0';

export function createWebGpuDeviceCache({ gpu = globalThis.navigator?.gpu } = {}) {
  let devicePromise = null;
  const getDevice = async () => {
    if (!devicePromise) {
      devicePromise = Promise.resolve().then(async () => {
        if (!gpu || typeof gpu.requestAdapter !== 'function') throw new Error('webgpu-adapter-unavailable');
        const adapter = await gpu.requestAdapter();
        if (!adapter || typeof adapter.requestDevice !== 'function') throw new Error('webgpu-adapter-unavailable');
        return adapter.requestDevice();
      }).catch(error => { devicePromise = null; throw error; });
    }
    return devicePromise;
  };
  const reset = () => { devicePromise = null; };
  return Object.freeze({ schema: WEBGPU_DEVICE_CACHE_SCHEMA, getDevice, reset });
}
