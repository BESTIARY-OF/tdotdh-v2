import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';

export const WEBGPU_CANDIDATE_PREFILTER_SCHEMA = 'tdotdh.webgpu-candidate-prefilter.v0';
export const DEFAULT_PREFILTER_BOUNDS = Object.freeze({ minX: -32, maxX: 32, minY: -32, maxY: 32 });

const SENTINEL = 0x7fffffff;
const SHADER = `
struct Params {
  candidateCount: u32,
  maxCells: u32,
  rowStride: u32,
  minX: i32,
  maxX: i32,
  minY: i32,
  maxY: i32,
  reserved: u32,
};
@group(0) @binding(0) var<storage, read> inputCells: array<i32>;
@group(0) @binding(1) var<storage, read_write> validity: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.candidateCount) { return; }
  let base = id.x * params.rowStride;
  let count = inputCells[base];
  var valid = count > 0 && count <= i32(params.maxCells);
  for (var i: u32 = 0u; i < params.maxCells; i++) {
    if (i >= u32(max(count, 0))) { break; }
    let x = inputCells[base + 1u + i * 2u];
    let y = inputCells[base + 2u + i * 2u];
    if (x < params.minX || x > params.maxX || y < params.minY || y > params.maxY) { valid = false; }
    for (var j: u32 = 0u; j < params.maxCells; j++) {
      if (j >= i) { break; }
      let priorX = inputCells[base + 1u + j * 2u];
      let priorY = inputCells[base + 2u + j * 2u];
      if (x == priorX && y == priorY) { valid = false; }
    }
  }
  validity[id.x] = select(0u, 1u, valid);
}`;

function requireBounds(bounds) {
  const normalized = { ...DEFAULT_PREFILTER_BOUNDS, ...bounds };
  for (const key of ['minX', 'maxX', 'minY', 'maxY']) {
    if (!Number.isSafeInteger(normalized[key])) throw new TypeError(`bounds.${key} must be a safe integer`);
  }
  if (normalized.minX > normalized.maxX || normalized.minY > normalized.maxY) throw new TypeError('bounds must have ordered limits');
  return normalized;
}

function flattenCandidate(candidate, index) {
  if (!Array.isArray(candidate) || candidate.length === 0) throw new TypeError(`candidate ${index} must be a non-empty array`);
  const cells = [];
  for (const item of candidate) {
    const source = Array.isArray(item?.cells) ? item.cells : [item];
    for (const cell of source) {
      if (!Number.isSafeInteger(cell?.x) || !Number.isSafeInteger(cell?.y)) throw new TypeError(`candidate ${index} contains invalid cell coordinates`);
      cells.push({ x: cell.x, y: cell.y });
    }
  }
  if (cells.length === 0) throw new TypeError(`candidate ${index} must contain cells`);
  return cells;
}

function normalizeCandidates(candidates, bounds) {
  if (!Array.isArray(candidates) || candidates.length === 0) throw new TypeError('candidates must be a non-empty array');
  const normalizedBounds = requireBounds(bounds);
  const cells = candidates.map(flattenCandidate);
  const maxCells = Math.max(...cells.map(value => value.length));
  const rowStride = 1 + maxCells * 2;
  const input = new Int32Array(candidates.length * rowStride);
  input.fill(SENTINEL);
  cells.forEach((candidate, index) => {
    const base = index * rowStride;
    input[base] = candidate.length;
    candidate.forEach((cell, cellIndex) => {
      input[base + 1 + cellIndex * 2] = cell.x;
      input[base + 2 + cellIndex * 2] = cell.y;
    });
  });
  return { bounds: normalizedBounds, cells, input, maxCells, rowStride };
}

export function cpuCandidatePrefilter(candidates, bounds = DEFAULT_PREFILTER_BOUNDS) {
  const normalized = normalizeCandidates(candidates, bounds);
  const validity = normalized.cells.map(cells => {
    const seen = new Set();
    return cells.every(cell => {
      if (cell.x < normalized.bounds.minX || cell.x > normalized.bounds.maxX || cell.y < normalized.bounds.minY || cell.y > normalized.bounds.maxY) return false;
      const key = `${cell.x},${cell.y}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }) ? 1 : 0;
  });
  return { validity, acceptedIndices: validity.flatMap((value, index) => value ? [index] : []) };
}

function unavailable(reason, bounds) {
  return Object.freeze({ schema: WEBGPU_CANDIDATE_PREFILTER_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason), bounds: Object.freeze({ ...bounds }) });
}

export function createWebGpuCandidatePrefilter({ gpu = globalThis.navigator?.gpu, requiredLimits = { maxStorageBufferBindingSize: 65536 }, bounds = DEFAULT_PREFILTER_BOUNDS, shaderSource = SHADER } = {}) {
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  const normalizedBounds = requireBounds(bounds);
  const limits = { ...requiredLimits };
  return Object.freeze({
    async availability() {
      const probe = await probeWebGpuCapabilities({ gpu, requiredLimits: limits });
      if (!probe.adapterAvailable) return unavailable('webgpu-adapter-unavailable', normalizedBounds);
      if (!probe.requiredLimitsSatisfied) return unavailable('webgpu-required-limits-unsatisfied', normalizedBounds);
      return Object.freeze({ schema: WEBGPU_CANDIDATE_PREFILTER_SCHEMA, status: 'available', backend: 'webgpu', bounds: Object.freeze({ ...normalizedBounds }) });
    },
    async prefilter(candidates) {
      const normalized = normalizeCandidates(candidates, normalizedBounds);
      const status = await this.availability();
      if (status.status !== 'available') return status;
      let device;
      try {
        const adapter = await gpu.requestAdapter();
        device = await adapter.requestDevice();
        const input = device.createBuffer({ size: normalized.input.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const output = device.createBuffer({ size: Math.max(4, candidates.length * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        const params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const readback = device.createBuffer({ size: Math.max(4, candidates.length * 4), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(input, 0, normalized.input);
        device.queue.writeBuffer(params, 0, new Uint32Array([candidates.length, normalized.maxCells, normalized.rowStride, normalizedBounds.minX, normalizedBounds.maxX, normalizedBounds.minY, normalizedBounds.maxY, 0]));
        const module = device.createShaderModule({ code: shaderSource });
        const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
        const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: output } }, { binding: 2, resource: { buffer: params } }] });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(candidates.length / 64)); pass.end();
        encoder.copyBufferToBuffer(output, 0, readback, 0, Math.max(4, candidates.length * 4));
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        await readback.mapAsync(GPUMapMode.READ);
        const validity = Array.from(new Uint32Array(readback.getMappedRange().slice(0, candidates.length * 4)));
        readback.unmap();
        for (const buffer of [input, output, params, readback]) buffer.destroy();
        return Object.freeze({ schema: WEBGPU_CANDIDATE_PREFILTER_SCHEMA, status: 'completed', backend: 'webgpu', validity, acceptedIndices: validity.flatMap((value, index) => value ? [index] : []), candidateCount: candidates.length });
      } catch (error) {
        try { device?.destroy?.(); } catch {}
        return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, normalizedBounds);
      }
    },
  });
}

export { SHADER as DEFAULT_SHADER };
