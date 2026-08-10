import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';

export const WEBGPU_CANDIDATE_SCORER_SCHEMA = 'tdotdh.webgpu-candidate-scorer.v0';
export const DEFAULT_REQUIRED_LIMITS = Object.freeze({ maxStorageBufferBindingSize: 65536 });

const SHADER = `
struct Params { count: u32 };
@group(0) @binding(0) var<storage, read> inputValues: array<u32>;
@group(0) @binding(1) var<storage, read_write> outputScores: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.count) { return; }
  outputScores[id.x] = (inputValues[id.x] ^ 0x9e3779b9u) * 0x9e3779b1u;
}`;

function normalizeValues(values) {
  if (!Array.isArray(values) && !(values instanceof Uint32Array)) throw new TypeError('candidate values must be an array of unsigned integers');
  const normalized = Uint32Array.from(values, value => {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new TypeError('candidate values must be unsigned 32-bit integers');
    return value;
  });
  if (normalized.length === 0) throw new TypeError('candidate values must not be empty');
  return normalized;
}

export function cpuCandidateScores(values) {
  return Array.from(normalizeValues(values), value => Math.imul(value ^ 0x9e3779b9, 0x9e3779b1) >>> 0);
}

function unavailable(reason, requiredLimits) {
  return Object.freeze({
    schema: WEBGPU_CANDIDATE_SCORER_SCHEMA,
    status: 'unavailable',
    backend: 'webgpu',
    reason: String(reason),
    requiredLimits: Object.freeze({ ...requiredLimits }),
  });
}

export function createWebGpuCandidateScorer({ gpu = globalThis.navigator?.gpu, requiredLimits = DEFAULT_REQUIRED_LIMITS, shaderSource = SHADER } = {}) {
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  const limits = { ...requiredLimits };

  return Object.freeze({
    async availability() {
      const probe = await probeWebGpuCapabilities({ gpu, requiredLimits: limits });
      if (!probe.adapterAvailable) return unavailable('webgpu-adapter-unavailable', limits);
      if (!probe.requiredLimitsSatisfied) return unavailable('webgpu-required-limits-unsatisfied', limits);
      return Object.freeze({ schema: WEBGPU_CANDIDATE_SCORER_SCHEMA, status: 'available', backend: 'webgpu', requiredLimits: Object.freeze(limits) });
    },

    async score(values) {
      const normalized = normalizeValues(values);
      const status = await this.availability();
      if (status.status !== 'available') return status;

      let device;
      try {
        const adapter = await gpu.requestAdapter();
        device = await adapter.requestDevice();
        const byteLength = normalized.byteLength;
        const input = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const output = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const readback = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(input, 0, normalized);
        device.queue.writeBuffer(params, 0, new Uint32Array([normalized.length]));
        const module = device.createShaderModule({ code: shaderSource });
        const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
        const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: input } },
          { binding: 1, resource: { buffer: output } },
          { binding: 2, resource: { buffer: params } },
        ] });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(normalized.length / 64));
        pass.end();
        encoder.copyBufferToBuffer(output, 0, readback, 0, byteLength);
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        await readback.mapAsync(GPUMapMode.READ);
        const scores = Array.from(new Uint32Array(readback.getMappedRange().slice(0)));
        readback.unmap();
        for (const buffer of [input, output, params, readback]) buffer.destroy();
        return Object.freeze({ schema: WEBGPU_CANDIDATE_SCORER_SCHEMA, status: 'completed', backend: 'webgpu', scores, inputCount: normalized.length });
      } catch (error) {
        try { device?.destroy?.(); } catch {}
        return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, limits);
      }
    },
  });
}

export { SHADER as DEFAULT_SHADER };
