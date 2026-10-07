import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_EXECUTION_PROBE_SCHEMA = 'tdotdh.webgpu-execution-probe.v0';
const SMOKE_SHADER = '@compute @workgroup_size(1) fn main() {}';

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
export async function probeWebGpuExecutionCapabilities({ gpu = globalThis.navigator?.gpu, requiredLimits = {}, deviceCache = createWebGpuDeviceCache({ gpu }), smokeTest = true } = {}) {
  const capability = await probeWebGpuCapabilities({ gpu, requiredLimits });
  if (!capability.adapterAvailable) return unavailable(capability, 'webgpu-adapter-unavailable');
  if (!capability.requiredLimitsSatisfied) return unavailable(capability, 'webgpu-required-limits-unsatisfied');

  try {
    const device = await deviceCache.getDevice();
    if (!device) return unavailable(capability, 'webgpu-device-unavailable');
    if (smokeTest) {
      const module = device.createShaderModule({ code: SMOKE_SHADER });
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.dispatchWorkgroups(1);
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    }
    return Object.freeze({
      schema: WEBGPU_EXECUTION_PROBE_SCHEMA,
      adapterAvailable: true,
      deviceAvailable: true,
      requiredLimits: capability.requiredLimits,
      requiredLimitsSatisfied: true,
      ...(smokeTest ? { smoke: 'compute-dispatch-verified' } : {}),
    });
  } catch (error) {
    deviceCache.reset();
    return unavailable(capability, `webgpu-device-request-failed:${error?.message || String(error)}`);
  }
}
