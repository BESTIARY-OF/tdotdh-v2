import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_EXECUTION_PROBE_SCHEMA = 'tdotdh.webgpu-execution-probe.v0';

function unavailable(capability, reason) {
  return Object.freeze({
    schema: WEBGPU_EXECUTION_PROBE_SCHEMA,
    adapterAvailable: capability.adapterAvailable,
    deviceAvailable: false,
    requiredLimits: capability.requiredLimits,
    requiredLimitsSatisfied: capability.requiredLimitsSatisfied,
    reason,
  });
}

/**
 * Distinguishes an exposed WebGPU adapter from a device that the page can
 * actually create. No work is dispatched here; this is only an honest
 * execution gate for the product's accelerated paths.
 */
export async function probeWebGpuExecutionCapabilities({ gpu = globalThis.navigator?.gpu, requiredLimits = {}, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  const capability = await probeWebGpuCapabilities({ gpu, requiredLimits });
  if (!capability.adapterAvailable) return unavailable(capability, 'webgpu-adapter-unavailable');
  if (!capability.requiredLimitsSatisfied) return unavailable(capability, 'webgpu-required-limits-unsatisfied');

  try {
    const device = await deviceCache.getDevice();
    if (!device) return unavailable(capability, 'webgpu-device-unavailable');
    return Object.freeze({
      schema: WEBGPU_EXECUTION_PROBE_SCHEMA,
      adapterAvailable: true,
      deviceAvailable: true,
      requiredLimits: capability.requiredLimits,
      requiredLimitsSatisfied: true,
    });
  } catch (error) {
    deviceCache.reset();
    return unavailable(capability, `webgpu-device-request-failed:${error?.message || String(error)}`);
  }
}
