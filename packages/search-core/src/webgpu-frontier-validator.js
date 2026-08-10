import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_FRONTIER_VALIDATOR_SCHEMA = 'tdotdh.webgpu-frontier-validator.v0';
export const DEFAULT_FRONTIER_GRID = Object.freeze({ width: 64, height: 64, originX: -32, originY: -32 });

const SHADER = `
struct Params {
  candidateCount: u32,
  wordCount: u32,
  reserved0: u32,
  reserved1: u32,
};
@group(0) @binding(0) var<storage, read> parentMasks: array<u32>;
@group(0) @binding(1) var<storage, read> candidateMasks: array<u32>;
@group(0) @binding(2) var<storage, read_write> validity: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.candidateCount) { return; }
  let base = id.x * params.wordCount;
  var valid = true;
  for (var word: u32 = 0u; word < params.wordCount; word++) {
    if ((parentMasks[base + word] & candidateMasks[base + word]) != 0u) { valid = false; }
  }
  validity[id.x] = select(0u, 1u, valid);
}`;

function normalizeGrid(grid = DEFAULT_FRONTIER_GRID) {
  const value = { ...DEFAULT_FRONTIER_GRID, ...grid };
  for (const key of ['width', 'height']) {
    if (!Number.isSafeInteger(value[key]) || value[key] <= 0 || value[key] > 128) throw new TypeError(`grid.${key} must be a positive safe integer at most 128`);
  }
  for (const key of ['originX', 'originY']) {
    if (!Number.isSafeInteger(value[key])) throw new TypeError(`grid.${key} must be a safe integer`);
  }
  return Object.freeze({ width: value.width, height: value.height, originX: value.originX, originY: value.originY, wordCount: Math.ceil((value.width * value.height) / 32) });
}

export function createFrontierMaskFromCells(cells, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid);
  if (!Array.isArray(cells) || cells.length === 0) throw new TypeError('cells must be a non-empty array');
  const mask = new Uint32Array(normalizedGrid.wordCount);
  for (const cell of cells) {
    if (!Number.isSafeInteger(cell?.x) || !Number.isSafeInteger(cell?.y)) throw new TypeError('cells must contain integer x/y coordinates');
    const x = cell.x - normalizedGrid.originX, y = cell.y - normalizedGrid.originY;
    if (x < 0 || x >= normalizedGrid.width || y < 0 || y >= normalizedGrid.height) throw new RangeError('cell lies outside the frontier grid');
    const bit = y * normalizedGrid.width + x;
    mask[Math.floor(bit / 32)] |= 1 << (bit % 32);
  }
  return mask;
}

function normalizeMask(mask, wordCount, label) {
  if (!Array.isArray(mask) && !(mask instanceof Uint32Array)) throw new TypeError(`${label} must be a uint32 word array`);
  if (mask.length !== wordCount) throw new RangeError(`${label} must contain exactly ${wordCount} words`);
  return Uint32Array.from(mask, word => {
    if (!Number.isSafeInteger(word) || word < 0 || word > 0xffffffff) throw new TypeError(`${label} contains a non-uint32 word`);
    return word;
  });
}

function normalizeCandidates(candidates, grid) {
  if (!Array.isArray(candidates) || candidates.length === 0) throw new TypeError('frontier candidates must be a non-empty array');
  const normalized = candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') throw new TypeError(`frontier candidate ${index} must be an object`);
    return Object.freeze({
      parentMask: normalizeMask(candidate.parentMask, grid.wordCount, `frontier candidate ${index}.parentMask`),
      candidateMask: normalizeMask(candidate.candidateMask, grid.wordCount, `frontier candidate ${index}.candidateMask`),
      depth: Number(candidate.depth ?? 0),
      branchCursor: Number(candidate.branchCursor ?? index),
      nodeCursor: Number(candidate.nodeCursor ?? index),
    });
  });
  for (const candidate of normalized) {
    for (const [value, label] of [[candidate.depth, 'depth'], [candidate.branchCursor, 'branchCursor'], [candidate.nodeCursor, 'nodeCursor']]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`frontier candidate ${label} must be a non-negative safe integer`);
    }
  }
  return normalized;
}

function flattenMasks(candidates, property, wordCount) {
  const flat = new Uint32Array(candidates.length * wordCount);
  candidates.forEach((candidate, index) => flat.set(candidate[property], index * wordCount));
  return flat;
}

export function cpuValidateFrontierCandidates(candidates, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid);
  const normalized = normalizeCandidates(candidates, normalizedGrid);
  const validity = normalized.map(candidate => {
    for (let word = 0; word < normalizedGrid.wordCount; word += 1) {
      if ((candidate.parentMask[word] & candidate.candidateMask[word]) !== 0) return 0;
    }
    return 1;
  });
  return Object.freeze({
    schema: WEBGPU_FRONTIER_VALIDATOR_SCHEMA,
    status: 'completed',
    backend: 'cpu-oracle',
    validity,
    acceptedIndices: validity.flatMap((value, index) => value ? [index] : []),
    candidateCount: normalized.length,
    wordCount: normalizedGrid.wordCount,
  });
}

function unavailable(reason, grid) {
  return Object.freeze({
    schema: WEBGPU_FRONTIER_VALIDATOR_SCHEMA,
    status: 'unavailable',
    backend: 'webgpu',
    reason: String(reason),
    grid,
  });
}

export function createWebGpuFrontierValidator({ gpu = globalThis.navigator?.gpu, grid = DEFAULT_FRONTIER_GRID, requiredLimits = { maxStorageBufferBindingSize: 65536 }, shaderSource = SHADER, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  const normalizedGrid = normalizeGrid(grid);
  const limits = { ...requiredLimits };
  return Object.freeze({
    async availability() {
      const probe = await probeWebGpuCapabilities({ gpu, requiredLimits: limits });
      if (!probe.adapterAvailable) return unavailable('webgpu-adapter-unavailable', normalizedGrid);
      if (!probe.requiredLimitsSatisfied) return unavailable('webgpu-required-limits-unsatisfied', normalizedGrid);
      return Object.freeze({ schema: WEBGPU_FRONTIER_VALIDATOR_SCHEMA, status: 'available', backend: 'webgpu', grid: normalizedGrid });
    },
    async validate(candidates) {
      const normalized = normalizeCandidates(candidates, normalizedGrid);
      const status = await this.availability();
      if (status.status !== 'available') return status;
      let device;
      try {
        const parent = flattenMasks(normalized, 'parentMask', normalizedGrid.wordCount);
        const candidate = flattenMasks(normalized, 'candidateMask', normalizedGrid.wordCount);
        const byteLength = Math.max(4, normalized.length * normalizedGrid.wordCount * 4);
        device = await deviceCache.getDevice();
        const parentBuffer = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const candidateBuffer = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const outputBuffer = device.createBuffer({ size: Math.max(4, normalized.length * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        const paramsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const readback = device.createBuffer({ size: Math.max(4, normalized.length * 4), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(parentBuffer, 0, parent);
        device.queue.writeBuffer(candidateBuffer, 0, candidate);
        device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([normalized.length, normalizedGrid.wordCount, 0, 0]));
        const module = device.createShaderModule({ code: shaderSource });
        const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
        const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: parentBuffer } },
          { binding: 1, resource: { buffer: candidateBuffer } },
          { binding: 2, resource: { buffer: outputBuffer } },
          { binding: 3, resource: { buffer: paramsBuffer } },
        ] });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(normalized.length / 64)); pass.end();
        encoder.copyBufferToBuffer(outputBuffer, 0, readback, 0, Math.max(4, normalized.length * 4));
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        await readback.mapAsync(GPUMapMode.READ);
        const validity = Array.from(new Uint32Array(readback.getMappedRange().slice(0, normalized.length * 4)));
        readback.unmap();
        for (const buffer of [parentBuffer, candidateBuffer, outputBuffer, paramsBuffer, readback]) buffer.destroy();
        return Object.freeze({ schema: WEBGPU_FRONTIER_VALIDATOR_SCHEMA, status: 'completed', backend: 'webgpu', validity, acceptedIndices: validity.flatMap((value, index) => value ? [index] : []), candidateCount: normalized.length, wordCount: normalizedGrid.wordCount });
      } catch (error) {
        deviceCache.reset();
        return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, normalizedGrid);
      }
    },
  });
}

export { SHADER as DEFAULT_SHADER };
