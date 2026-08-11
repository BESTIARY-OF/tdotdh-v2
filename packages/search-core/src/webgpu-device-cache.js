export const WEBGPU_DEVICE_CACHE_SCHEMA = 'tdotdh.webgpu-device-cache.v0';

export function createWebGpuDeviceCache({ gpu = globalThis.navigator?.gpu, requiredLimits = {} } = {}) {
  const normalizedRequiredLimits = Object.freeze({ ...requiredLimits });
  let devicePromise = null, currentDevice = null;
  const getDevice = async () => {
    if (!devicePromise) {
      devicePromise = Promise.resolve().then(async () => {
        if (!gpu || typeof gpu.requestAdapter !== 'function') throw new Error('webgpu-adapter-unavailable');
        const adapter = await gpu.requestAdapter();
        if (!adapter || typeof adapter.requestDevice !== 'function') throw new Error('webgpu-adapter-unavailable');
        return Object.keys(normalizedRequiredLimits).length
          ? adapter.requestDevice({ requiredLimits: normalizedRequiredLimits })
          : adapter.requestDevice();
      }).then(device => {
        currentDevice = device;
        if (device?.lost && typeof device.lost.then === 'function') Promise.resolve(device.lost).then(() => { if (currentDevice === device) { currentDevice = null; devicePromise = null; } }, () => { if (currentDevice === device) { currentDevice = null; devicePromise = null; } });
        return device;
      }).catch(error => { devicePromise = null; currentDevice = null; throw error; });
    }
    return devicePromise;
  };
  const reset = () => { devicePromise = null; currentDevice = null; };
  return Object.freeze({ schema: WEBGPU_DEVICE_CACHE_SCHEMA, getDevice, reset });
}
