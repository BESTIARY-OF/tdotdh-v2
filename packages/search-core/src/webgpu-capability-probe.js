/**
 * Observational WebGPU capability probe.
 *
 * This module deliberately stops at adapter availability and required-limit
 * evaluation. It does not request a device, create a pipeline, dispatch work,
 * or claim that the search backend is supported.
 */

export const WEBGPU_CAPABILITY_PROBE_SCHEMA = 'tdotdh.webgpu-capability-probe.v0';

function normalizeRequiredLimits(requiredLimits = {}) {
  if (!requiredLimits || typeof requiredLimits !== 'object' || Array.isArray(requiredLimits)) {
    throw new TypeError('requiredLimits must be an object');
  }

  return Object.fromEntries(Object.entries(requiredLimits).map(([name, value]) => {
    if (!name || !Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`required limit ${name || '<unnamed>'} must be a non-negative safe integer`);
    }
    return [name, value];
  }));
}

function unavailable(requiredLimits) {
  return Object.freeze({
    schema: WEBGPU_CAPABILITY_PROBE_SCHEMA,
    adapterAvailable: false,
    requiredLimits: Object.freeze(requiredLimits),
    requiredLimitsSatisfied: null,
  });
}

function limitsSatisfied(adapter, requiredLimits) {
  return Object.entries(requiredLimits).every(([name, minimum]) => {
    const available = Number(adapter?.limits?.[name]);
    return Number.isFinite(available) && available >= minimum;
  });
}

export async function probeWebGpuCapabilities({ gpu = globalThis.navigator?.gpu, requiredLimits = {} } = {}) {
  const normalizedLimits = normalizeRequiredLimits(requiredLimits);
  if (!gpu || typeof gpu.requestAdapter !== 'function') return unavailable(normalizedLimits);

  let adapter;
  try {
    adapter = await gpu.requestAdapter();
  } catch {
    return unavailable(normalizedLimits);
  }
  if (!adapter) return unavailable(normalizedLimits);

  return Object.freeze({
    schema: WEBGPU_CAPABILITY_PROBE_SCHEMA,
    adapterAvailable: true,
    requiredLimits: Object.freeze(normalizedLimits),
    requiredLimitsSatisfied: limitsSatisfied(adapter, normalizedLimits),
  });
}
