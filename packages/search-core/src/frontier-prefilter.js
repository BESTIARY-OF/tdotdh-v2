import { cpuValidateFrontierCandidates } from './webgpu-frontier-validator.js';

export const FRONTIER_PREFILTER_SCHEMA = 'tdotdh.frontier-prefilter.v0';

function sameValidity(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);
}
function fallback(reason, candidateCount, rejectedBackend = null) {
  return Object.freeze({
    schema: FRONTIER_PREFILTER_SCHEMA,
    status: 'fallback',
    backend: 'cpu-oracle',
    reason: String(reason),
    candidateCount,
    ...(rejectedBackend ? { rejectedBackend } : {}),
  });
}

/**
 * Run the CPU frontier validity oracle and optionally gate a WebGPU mask on
 * exact parity. The CPU mask remains authoritative on every failure path.
 */
export function createFrontierPrefilter({ accelerator = null, cpu = cpuValidateFrontierCandidates } = {}) {
  if (typeof cpu !== 'function') throw new TypeError('cpu frontier prefilter must be a function');
  return Object.freeze({
    async prefilter(candidates, { isCancelled = () => false } = {}) {
      const oracle = cpu(candidates);
      const candidateCount = oracle.validity.length;
      if (isCancelled()) return Object.freeze({ ...fallback('cancelled', candidateCount), status: 'cancelled' });
      if (!accelerator || typeof accelerator.validate !== 'function') return Object.freeze({ ...oracle, prefilter: fallback('frontier-accelerator-unavailable', candidateCount) });

      let accelerated;
      try {
        accelerated = await accelerator.validate(candidates);
      } catch (error) {
        accelerated = { status: 'unavailable', reason: `frontier-accelerator-error:${error?.message || String(error)}` };
      }
      if (isCancelled()) return Object.freeze({ ...fallback('cancelled', candidateCount), status: 'cancelled' });
      if (accelerated?.status !== 'completed') return Object.freeze({ ...oracle, prefilter: fallback(accelerated?.reason || 'frontier-accelerator-unavailable', candidateCount) });
      if (!sameValidity(accelerated.validity, oracle.validity)) {
        return Object.freeze({ ...oracle, prefilter: fallback('validity-mask-mismatch', candidateCount, accelerated.backend || 'webgpu') });
      }
      return Object.freeze({
        ...oracle,
        validity: [...accelerated.validity],
        acceptedIndices: accelerated.acceptedIndices || oracle.acceptedIndices,
        prefilter: Object.freeze({ schema: FRONTIER_PREFILTER_SCHEMA, status: 'used', backend: accelerated.backend || 'webgpu', parity: 'verified', candidateCount }),
      });
    },
  });
}
