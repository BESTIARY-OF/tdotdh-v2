import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { DEFAULT_FRONTIER_GRID, createFrontierMaskFromCells } from './webgpu-frontier-validator.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_FRONTIER_STATE_SCHEMA = 'tdotdh.webgpu-frontier-state.v0';
export const REMAINING_MASK_WORD_COUNT = 4;

const SHADER = `
struct Params {
  candidateCount: u32,
  wordCount: u32,
  width: u32,
  height: u32,
  originX: i32,
  originY: i32,
  reserved0: u32,
  reserved1: u32,
};
@group(0) @binding(0) var<storage, read> parentMasks: array<u32>;
@group(0) @binding(1) var<storage, read> candidateMasks: array<u32>;
@group(0) @binding(2) var<storage, read> remainingMasks: array<u32>;
@group(0) @binding(3) var<storage, read_write> nextMasks: array<u32>;
@group(0) @binding(4) var<storage, read_write> canonicalMasks: array<u32>;
@group(0) @binding(5) var<storage, read_write> stateHashes: array<u32>;
@group(0) @binding(6) var<uniform> params: Params;

fn nextBit(base: u32, offset: u32) -> u32 { return (nextMasks[base + offset / 32u] >> (offset % 32u)) & 1u; }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.candidateCount) { return; }
  let base = id.x * params.wordCount;
  for (var word: u32 = 0u; word < params.wordCount; word++) {
    nextMasks[base + word] = parentMasks[base + word] | candidateMasks[base + word];
    canonicalMasks[base + word] = 0u;
  }
  var found = false;
  var minX: i32 = 0;
  var minY: i32 = 0;
  for (var y: u32 = 0u; y < params.height; y++) {
    for (var x: u32 = 0u; x < params.width; x++) {
      let offset = y * params.width + x;
      if (nextBit(base, offset) == 1u) {
        if (!found) { minX = i32(x); minY = i32(y); found = true; }
        else { minX = min(minX, i32(x)); minY = min(minY, i32(y)); }
      }
    }
  }
  if (found) {
    for (var y: u32 = 0u; y < params.height; y++) {
      for (var x: u32 = 0u; x < params.width; x++) {
        let offset = y * params.width + x;
        if (nextBit(base, offset) == 1u) {
          let canonicalX = x - u32(minX);
          let canonicalY = y - u32(minY);
          if (canonicalX < params.width && canonicalY < params.height) {
            let canonicalOffset = canonicalY * params.width + canonicalX;
            canonicalMasks[base + canonicalOffset / 32u] = canonicalMasks[base + canonicalOffset / 32u] | (1u << (canonicalOffset % 32u));
          }
        }
      }
    }
  }
  var hash: u32 = 2166136261u;
  for (var word: u32 = 0u; word < params.wordCount; word++) { hash = (hash ^ canonicalMasks[base + word]) * 16777619u; }
  let remainingBase = id.x * ${REMAINING_MASK_WORD_COUNT}u;
  for (var word: u32 = 0u; word < ${REMAINING_MASK_WORD_COUNT}u; word++) { hash = (hash ^ remainingMasks[remainingBase + word]) * 16777619u; }
  stateHashes[id.x] = hash;
}`;

function normalizeGrid(grid = DEFAULT_FRONTIER_GRID) {
  const value = { ...DEFAULT_FRONTIER_GRID, ...grid };
  for (const key of ['width', 'height']) if (!Number.isSafeInteger(value[key]) || value[key] <= 0 || value[key] > 128) throw new TypeError(`grid.${key} must be a positive safe integer at most 128`);
  for (const key of ['originX', 'originY']) if (!Number.isSafeInteger(value[key])) throw new TypeError(`grid.${key} must be a safe integer`);
  return Object.freeze({ width: value.width, height: value.height, originX: value.originX, originY: value.originY, wordCount: Math.ceil(value.width * value.height / 32) });
}

function normalizeMask(mask, wordCount, label) {
  if (!Array.isArray(mask) && !(mask instanceof Uint32Array)) throw new TypeError(`${label} must be a uint32 word array`);
  if (mask.length !== wordCount) throw new RangeError(`${label} must contain exactly ${wordCount} words`);
  return Uint32Array.from(mask, word => {
    if (!Number.isSafeInteger(word) || word < 0 || word > 0xffffffff) throw new TypeError(`${label} contains a non-uint32 word`);
    return word;
  });
}

function remainingMask(ids) {
  if (!Array.isArray(ids)) throw new TypeError('remainingIds must be an array');
  const mask = new Uint32Array(REMAINING_MASK_WORD_COUNT);
  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id < 0 || id >= REMAINING_MASK_WORD_COUNT * 32) throw new TypeError('remainingIds entries must be integers from 0 through 127');
    mask[Math.floor(id / 32)] |= 1 << (id % 32);
  }
  return mask;
}

function normalizeCandidates(candidates, grid) {
  if (!Array.isArray(candidates) || candidates.length === 0) throw new TypeError('frontier state candidates must be a non-empty array');
  return candidates.map((candidate, index) => Object.freeze({
    parentMask: normalizeMask(candidate?.parentMask, grid.wordCount, `frontier state candidate ${index}.parentMask`),
    candidateMask: normalizeMask(candidate?.candidateMask, grid.wordCount, `frontier state candidate ${index}.candidateMask`),
    remainingMask: normalizeMask(candidate?.remainingMask, REMAINING_MASK_WORD_COUNT, `frontier state candidate ${index}.remainingMask`),
  }));
}

export function createFrontierStateCandidate({ parentCells, candidateCells, remainingIds } = {}, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid);
  return Object.freeze({ parentMask: createFrontierMaskFromCells(parentCells, normalizedGrid), candidateMask: createFrontierMaskFromCells(candidateCells, normalizedGrid), remainingMask: remainingMask(remainingIds) });
}

function canonicalize(mask, grid) {
  let minX = Infinity, minY = Infinity;
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
    const offset = y * grid.width + x;
    if (((mask[Math.floor(offset / 32)] >>> (offset % 32)) & 1) === 1) { minX = Math.min(minX, x); minY = Math.min(minY, y); }
  }
  const canonical = new Uint32Array(grid.wordCount);
  if (!Number.isFinite(minX)) return canonical;
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
    const offset = y * grid.width + x;
    if (((mask[Math.floor(offset / 32)] >>> (offset % 32)) & 1) !== 1) continue;
    const canonicalOffset = (y - minY) * grid.width + (x - minX);
    canonical[Math.floor(canonicalOffset / 32)] |= 1 << (canonicalOffset % 32);
  }
  return canonical;
}

function hashState(canonical, remaining) {
  let hash = 2166136261;
  for (const word of [...canonical, ...remaining]) hash = Math.imul(hash ^ word, 16777619) >>> 0;
  return hash;
}

export function cpuTransitionFrontierStates(candidates, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid), normalized = normalizeCandidates(candidates, normalizedGrid), nextMasks = [], canonicalMasks = [], hashes = [];
  for (const candidate of normalized) {
    const next = Uint32Array.from(candidate.parentMask, (word, index) => word | candidate.candidateMask[index]);
    const canonical = canonicalize(next, normalizedGrid);
    nextMasks.push(...next); canonicalMasks.push(...canonical); hashes.push(hashState(canonical, candidate.remainingMask));
  }
  return Object.freeze({ schema: WEBGPU_FRONTIER_STATE_SCHEMA, status: 'completed', backend: 'cpu-oracle', nextMasks, canonicalMasks, hashes, candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, parity: 'oracle' });
}

function unavailable(reason, grid, cpu) { return Object.freeze({ schema: WEBGPU_FRONTIER_STATE_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason), grid, nextMasks: cpu.nextMasks, canonicalMasks: cpu.canonicalMasks, hashes: cpu.hashes, candidateCount: cpu.candidateCount, wordCount: cpu.wordCount }); }

function flatten(candidates, property, width) {
  const flat = new Uint32Array(candidates.length * width);
  candidates.forEach((candidate, index) => flat.set(candidate[property], index * width));
  return flat;
}

async function runGpuBatch(device, normalized, grid, shaderSource) {
  const count = normalized.length, maskBytes = Math.max(4, count * grid.wordCount * 4), remainingBytes = Math.max(4, count * REMAINING_MASK_WORD_COUNT * 4), hashBytes = Math.max(4, count * 4);
  const buffers = {
    parent: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    candidate: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    remaining: device.createBuffer({ size: remainingBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    next: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    canonical: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    hashes: device.createBuffer({ size: hashBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    params: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    nextReadback: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    canonicalReadback: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    hashReadback: device.createBuffer({ size: hashBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
  };
  try {
    device.queue.writeBuffer(buffers.parent, 0, flatten(normalized, 'parentMask', grid.wordCount));
    device.queue.writeBuffer(buffers.candidate, 0, flatten(normalized, 'candidateMask', grid.wordCount));
    device.queue.writeBuffer(buffers.remaining, 0, flatten(normalized, 'remainingMask', REMAINING_MASK_WORD_COUNT));
    device.queue.writeBuffer(buffers.params, 0, new Int32Array([normalized.length, grid.wordCount, grid.width, grid.height, grid.originX, grid.originY, 0, 0]));
    const module = device.createShaderModule({ code: shaderSource }), pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: buffers.parent } }, { binding: 1, resource: { buffer: buffers.candidate } }, { binding: 2, resource: { buffer: buffers.remaining } }, { binding: 3, resource: { buffer: buffers.next } }, { binding: 4, resource: { buffer: buffers.canonical } }, { binding: 5, resource: { buffer: buffers.hashes } }, { binding: 6, resource: { buffer: buffers.params } },
    ] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end(); encoder.copyBufferToBuffer(buffers.next, 0, buffers.nextReadback, 0, maskBytes); encoder.copyBufferToBuffer(buffers.canonical, 0, buffers.canonicalReadback, 0, maskBytes); encoder.copyBufferToBuffer(buffers.hashes, 0, buffers.hashReadback, 0, hashBytes); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    await buffers.nextReadback.mapAsync(GPUMapMode.READ); const nextMasks = Array.from(new Uint32Array(buffers.nextReadback.getMappedRange().slice(0, count * grid.wordCount * 4))); buffers.nextReadback.unmap();
    await buffers.canonicalReadback.mapAsync(GPUMapMode.READ); const canonicalMasks = Array.from(new Uint32Array(buffers.canonicalReadback.getMappedRange().slice(0, count * grid.wordCount * 4))); buffers.canonicalReadback.unmap();
    await buffers.hashReadback.mapAsync(GPUMapMode.READ); const hashes = Array.from(new Uint32Array(buffers.hashReadback.getMappedRange().slice(0, count * 4))); buffers.hashReadback.unmap();
    return { nextMasks, canonicalMasks, hashes };
  } finally { Object.values(buffers).forEach(buffer => buffer.destroy()); }
}

export function createWebGpuFrontierState({ gpu = globalThis.navigator?.gpu, grid = DEFAULT_FRONTIER_GRID, requiredLimits = { maxStorageBufferBindingSize: 262144 }, shaderSource = SHADER, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  const normalizedGrid = normalizeGrid(grid), limits = { ...requiredLimits };
  return Object.freeze({
    async availability() {
      const probe = await probeWebGpuCapabilities({ gpu, requiredLimits: limits });
      if (!probe.adapterAvailable) return Object.freeze({ schema: WEBGPU_FRONTIER_STATE_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: 'webgpu-adapter-unavailable', grid: normalizedGrid });
      if (!probe.requiredLimitsSatisfied) return Object.freeze({ schema: WEBGPU_FRONTIER_STATE_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: 'webgpu-required-limits-unsatisfied', grid: normalizedGrid });
      return Object.freeze({ schema: WEBGPU_FRONTIER_STATE_SCHEMA, status: 'available', backend: 'webgpu', grid: normalizedGrid });
    },
    async transition(candidates) {
      const normalized = normalizeCandidates(candidates, normalizedGrid), cpu = cpuTransitionFrontierStates(normalized, normalizedGrid), status = await this.availability();
      if (status.status !== 'available') return unavailable(status.reason, normalizedGrid, cpu);
      try {
        const device = await deviceCache.getDevice(), maxBinding = Number(device.limits?.maxStorageBufferBindingSize) || limits.maxStorageBufferBindingSize, maxBatch = Math.max(1, Math.floor(maxBinding / Math.max(normalizedGrid.wordCount * 4, 4))), nextMasks = [], canonicalMasks = [], hashes = [];
        for (let offset = 0; offset < normalized.length; offset += maxBatch) { const result = await runGpuBatch(device, normalized.slice(offset, offset + maxBatch), normalizedGrid, shaderSource); nextMasks.push(...result.nextMasks); canonicalMasks.push(...result.canonicalMasks); hashes.push(...result.hashes); }
        if (JSON.stringify(nextMasks) !== JSON.stringify(cpu.nextMasks) || JSON.stringify(canonicalMasks) !== JSON.stringify(cpu.canonicalMasks) || JSON.stringify(hashes) !== JSON.stringify(cpu.hashes)) return unavailable('oracle-parity-mismatch', normalizedGrid, cpu);
        return Object.freeze({ schema: WEBGPU_FRONTIER_STATE_SCHEMA, status: 'completed', backend: 'webgpu', nextMasks, canonicalMasks, hashes, candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, parity: 'verified' });
      } catch (error) { deviceCache.reset(); return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, normalizedGrid, cpu); }
    },
  });
}

export { SHADER as DEFAULT_SHADER };
