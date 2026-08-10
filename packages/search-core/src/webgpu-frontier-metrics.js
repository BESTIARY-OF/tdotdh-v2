import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { DEFAULT_FRONTIER_GRID, createFrontierMaskFromCells } from './webgpu-frontier-validator.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_FRONTIER_METRICS_SCHEMA = 'tdotdh.webgpu-frontier-metrics.v0';
export const FRONTIER_METRIC_COUNT = 6;

const SHADER = `
struct Params {
  candidateCount: u32,
  wordCount: u32,
  width: u32,
  height: u32,
  originX: i32,
  originY: i32,
  minX: i32,
  maxX: i32,
  minY: i32,
  maxY: i32,
  reserved0: u32,
  reserved1: u32,
};
@group(0) @binding(0) var<storage, read> parentMasks: array<u32>;
@group(0) @binding(1) var<storage, read> candidateMasks: array<u32>;
@group(0) @binding(2) var<storage, read> centroidMasks: array<u32>;
@group(0) @binding(3) var<storage, read> ringMasks: array<u32>;
@group(0) @binding(4) var<storage, read_write> outputMetrics: array<i32>;
@group(0) @binding(5) var<uniform> params: Params;

fn bitOffset(x: i32, y: i32) -> u32 {
  let localX = u32(x - params.originX);
  let localY = u32(y - params.originY);
  return localY * params.width + localX;
}
fn parentBit(base: u32, x: i32, y: i32) -> u32 {
  if (x < params.originX || y < params.originY || x >= params.originX + i32(params.width) || y >= params.originY + i32(params.height)) { return 0u; }
  let offset = bitOffset(x, y);
  return (parentMasks[base + offset / 32u] >> (offset % 32u)) & 1u;
}
fn candidateBit(base: u32, x: i32, y: i32) -> u32 {
  if (x < params.originX || y < params.originY || x >= params.originX + i32(params.width) || y >= params.originY + i32(params.height)) { return 0u; }
  let offset = bitOffset(x, y);
  return (candidateMasks[base + offset / 32u] >> (offset % 32u)) & 1u;
}
fn centroidBit(base: u32, x: i32, y: i32) -> u32 {
  if (x < params.originX || y < params.originY || x >= params.originX + i32(params.width) || y >= params.originY + i32(params.height)) { return 0u; }
  let offset = bitOffset(x, y);
  return (centroidMasks[base + offset / 32u] >> (offset % 32u)) & 1u;
}
fn ringBit(base: u32, x: i32, y: i32) -> u32 {
  if (x < params.originX || y < params.originY || x >= params.originX + i32(params.width) || y >= params.originY + i32(params.height)) { return 0u; }
  let offset = bitOffset(x, y);
  return (ringMasks[base + offset / 32u] >> (offset % 32u)) & 1u;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.candidateCount) { return; }
  let base = id.x * params.wordCount;
  var contact: i32 = 0;
  var centroidContact: i32 = 0;
  var ringCoverage: i32 = 0;
  var openCentroid: i32 = 0;
  var found = false;
  var combinedMinX: i32 = 0;
  var combinedMaxX: i32 = 0;
  var combinedMinY: i32 = 0;
  var combinedMaxY: i32 = 0;
  for (var y: i32 = params.originY; y < params.originY + i32(params.height); y++) {
    for (var x: i32 = params.originX; x < params.originX + i32(params.width); x++) {
      let parent = parentBit(base, x, y);
      let candidate = candidateBit(base, x, y);
      let ring = ringBit(base, x, y);
      if (candidate == 1u) {
        if (parentBit(base, x + 1, y) == 1u) { contact += 1; }
        if (parentBit(base, x - 1, y) == 1u) { contact += 1; }
        if (parentBit(base, x, y + 1) == 1u) { contact += 1; }
        if (parentBit(base, x, y - 1) == 1u) { contact += 1; }
        for (var dx: i32 = -1; dx <= 1; dx++) for (var dy: i32 = -1; dy <= 1; dy++) {
          if ((dx != 0 || dy != 0) && centroidBit(base, x + dx, y + dy) == 1u) { centroidContact += 1; }
        }
        if (ring == 1u) { ringCoverage += 1; }
      } else if (ring == 1u && parent == 0u) {
        openCentroid += 1;
      }
      if (parent == 1u || candidate == 1u) {
        if (!found) { combinedMinX = x; combinedMaxX = x; combinedMinY = y; combinedMaxY = y; found = true; }
        else { combinedMinX = min(combinedMinX, x); combinedMaxX = max(combinedMaxX, x); combinedMinY = min(combinedMinY, y); combinedMaxY = max(combinedMaxY, y); }
      }
    }
  }
  let combinedArea = select(0, (combinedMaxX - combinedMinX + 1) * (combinedMaxY - combinedMinY + 1), found);
  let geometryScoreMilli = openCentroid * 40000 + combinedArea * 1000 - contact * 2400 - centroidContact * 2000 - ringCoverage * 8000;
  let outputBase = id.x * ${FRONTIER_METRIC_COUNT}u;
  outputMetrics[outputBase + 0u] = contact;
  outputMetrics[outputBase + 1u] = centroidContact;
  outputMetrics[outputBase + 2u] = ringCoverage;
  outputMetrics[outputBase + 3u] = openCentroid;
  outputMetrics[outputBase + 4u] = combinedArea;
  outputMetrics[outputBase + 5u] = geometryScoreMilli;
}`;

function normalizeGrid(grid = DEFAULT_FRONTIER_GRID) {
  const value = { ...DEFAULT_FRONTIER_GRID, ...grid };
  for (const key of ['width', 'height']) if (!Number.isSafeInteger(value[key]) || value[key] <= 0 || value[key] > 128) throw new TypeError(`grid.${key} must be a positive safe integer at most 128`);
  for (const key of ['originX', 'originY']) if (!Number.isSafeInteger(value[key])) throw new TypeError(`grid.${key} must be a safe integer`);
  return Object.freeze({ width: value.width, height: value.height, originX: value.originX, originY: value.originY, wordCount: Math.ceil(value.width * value.height / 32) });
}

function normalizeBounds(bounds = {}) {
  const result = {};
  for (const key of ['minX', 'maxX', 'minY', 'maxY']) {
    if (!Number.isSafeInteger(bounds[key])) throw new TypeError(`bounds.${key} must be a safe integer`);
    result[key] = bounds[key];
  }
  if (result.maxX < result.minX || result.maxY < result.minY) throw new RangeError('bounds must have max values at least as large as min values');
  return Object.freeze(result);
}

function normalizeMask(mask, wordCount, label) {
  if (!Array.isArray(mask) && !(mask instanceof Uint32Array)) throw new TypeError(`${label} must be a uint32 word array`);
  if (mask.length !== wordCount) throw new RangeError(`${label} must contain exactly ${wordCount} words`);
  return Uint32Array.from(mask, word => {
    if (!Number.isSafeInteger(word) || word < 0 || word > 0xffffffff) throw new TypeError(`${label} contains a non-uint32 word`);
    return word;
  });
}

function bit(mask, grid, x, y) {
  const localX = x - grid.originX, localY = y - grid.originY;
  if (localX < 0 || localY < 0 || localX >= grid.width || localY >= grid.height) return 0;
  const offset = localY * grid.width + localX;
  return (mask[Math.floor(offset / 32)] >>> (offset % 32)) & 1;
}

function normalizeCandidates(candidates, grid) {
  if (!Array.isArray(candidates) || candidates.length === 0) throw new TypeError('frontier metric candidates must be a non-empty array');
  return candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') throw new TypeError(`frontier metric candidate ${index} must be an object`);
    return Object.freeze({
      parentMask: normalizeMask(candidate.parentMask, grid.wordCount, `frontier metric candidate ${index}.parentMask`),
      candidateMask: normalizeMask(candidate.candidateMask, grid.wordCount, `frontier metric candidate ${index}.candidateMask`),
      centroidMask: normalizeMask(candidate.centroidMask, grid.wordCount, `frontier metric candidate ${index}.centroidMask`),
      ringMask: normalizeMask(candidate.ringMask, grid.wordCount, `frontier metric candidate ${index}.ringMask`),
      bounds: normalizeBounds(candidate.bounds),
    });
  });
}

export function createFrontierMetricsCandidate({ parentCells, candidateCells, centroidCells, ringCells, bounds } = {}, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid);
  return Object.freeze({
    parentMask: createFrontierMaskFromCells(parentCells, normalizedGrid),
    candidateMask: createFrontierMaskFromCells(candidateCells, normalizedGrid),
    centroidMask: createFrontierMaskFromCells(centroidCells, normalizedGrid),
    ringMask: createFrontierMaskFromCells(ringCells, normalizedGrid),
    bounds: normalizeBounds(bounds),
  });
}

function cpuMetricsForCandidate(candidate, grid) {
  let contact = 0, centroidContact = 0, ringCoverage = 0, openCentroid = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = grid.originY; y < grid.originY + grid.height; y++) for (let x = grid.originX; x < grid.originX + grid.width; x++) {
    const parent = bit(candidate.parentMask, grid, x, y), current = bit(candidate.candidateMask, grid, x, y), centroid = bit(candidate.centroidMask, grid, x, y), ring = bit(candidate.ringMask, grid, x, y);
    if (current) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) contact += bit(candidate.parentMask, grid, x + dx, y + dy);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if ((dx || dy) && bit(candidate.centroidMask, grid, x + dx, y + dy)) centroidContact++;
      if (ring) ringCoverage++;
    } else if (ring && !parent) openCentroid++;
    if (parent || current) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  const combinedArea = Number.isFinite(minX) ? (maxX - minX + 1) * (maxY - minY + 1) : 0;
  const geometryScoreMilli = openCentroid * 40000 + combinedArea * 1000 - contact * 2400 - centroidContact * 2000 - ringCoverage * 8000;
  return [contact, centroidContact, ringCoverage, openCentroid, combinedArea, geometryScoreMilli];
}

export function cpuEvaluateFrontierMetrics(candidates, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid), normalized = normalizeCandidates(candidates, normalizedGrid);
  const metrics = normalized.map(candidate => cpuMetricsForCandidate(candidate, normalizedGrid));
  return Object.freeze({ schema: WEBGPU_FRONTIER_METRICS_SCHEMA, status: 'completed', backend: 'cpu-oracle', metrics, candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, parity: 'oracle' });
}

function unavailable(reason, grid, cpu) {
  return Object.freeze({ schema: WEBGPU_FRONTIER_METRICS_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason), grid, metrics: cpu.metrics, candidateCount: cpu.candidateCount, wordCount: cpu.wordCount });
}

function flattenMasks(candidates, property, wordCount) {
  const flat = new Uint32Array(candidates.length * wordCount);
  candidates.forEach((candidate, index) => flat.set(candidate[property], index * wordCount));
  return flat;
}

async function runGpuBatch(device, normalized, grid, shaderSource) {
  const count = normalized.length, maskBytes = Math.max(4, count * grid.wordCount * 4), outputBytes = Math.max(4, count * FRONTIER_METRIC_COUNT * 4);
  const buffers = {
    parent: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    candidate: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    centroid: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    ring: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    output: device.createBuffer({ size: outputBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    params: device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    readback: device.createBuffer({ size: outputBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
  };
  try {
    device.queue.writeBuffer(buffers.parent, 0, flattenMasks(normalized, 'parentMask', grid.wordCount));
    device.queue.writeBuffer(buffers.candidate, 0, flattenMasks(normalized, 'candidateMask', grid.wordCount));
    device.queue.writeBuffer(buffers.centroid, 0, flattenMasks(normalized, 'centroidMask', grid.wordCount));
    device.queue.writeBuffer(buffers.ring, 0, flattenMasks(normalized, 'ringMask', grid.wordCount));
    const bounds = normalized[0].bounds;
    device.queue.writeBuffer(buffers.params, 0, new Int32Array([count, grid.wordCount, grid.width, grid.height, grid.originX, grid.originY, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 0, 0]));
    const module = device.createShaderModule({ code: shaderSource }), pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: buffers.parent } }, { binding: 1, resource: { buffer: buffers.candidate } }, { binding: 2, resource: { buffer: buffers.centroid } }, { binding: 3, resource: { buffer: buffers.ring } }, { binding: 4, resource: { buffer: buffers.output } }, { binding: 5, resource: { buffer: buffers.params } },
    ] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end(); encoder.copyBufferToBuffer(buffers.output, 0, buffers.readback, 0, outputBytes);
    device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone(); await buffers.readback.mapAsync(GPUMapMode.READ);
    const values = Array.from(new Int32Array(buffers.readback.getMappedRange().slice(0, count * FRONTIER_METRIC_COUNT * 4))); buffers.readback.unmap();
    return Array.from({ length: count }, (_, index) => values.slice(index * FRONTIER_METRIC_COUNT, (index + 1) * FRONTIER_METRIC_COUNT));
  } finally { Object.values(buffers).forEach(buffer => buffer.destroy()); }
}

export function createWebGpuFrontierMetrics({ gpu = globalThis.navigator?.gpu, grid = DEFAULT_FRONTIER_GRID, requiredLimits = { maxStorageBufferBindingSize: 262144 }, shaderSource = SHADER, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  const normalizedGrid = normalizeGrid(grid), limits = { ...requiredLimits };
  return Object.freeze({
    async availability() {
      const probe = await probeWebGpuCapabilities({ gpu, requiredLimits: limits });
      if (!probe.adapterAvailable) return unavailable('webgpu-adapter-unavailable', normalizedGrid, { metrics: [], candidateCount: 0, wordCount: normalizedGrid.wordCount });
      if (!probe.requiredLimitsSatisfied) return unavailable('webgpu-required-limits-unsatisfied', normalizedGrid, { metrics: [], candidateCount: 0, wordCount: normalizedGrid.wordCount });
      return Object.freeze({ schema: WEBGPU_FRONTIER_METRICS_SCHEMA, status: 'available', backend: 'webgpu', grid: normalizedGrid });
    },
    async evaluate(candidates) {
      const normalized = normalizeCandidates(candidates, normalizedGrid), cpu = cpuEvaluateFrontierMetrics(normalized, normalizedGrid), status = await this.availability();
      if (status.status !== 'available') return unavailable(status.reason, normalizedGrid, cpu);
      try {
        const device = await deviceCache.getDevice(), maxBinding = Number(device.limits?.maxStorageBufferBindingSize) || limits.maxStorageBufferBindingSize, maxBatch = Math.max(1, Math.floor(maxBinding / Math.max(normalizedGrid.wordCount * 4, 4))), metrics = [];
        for (let offset = 0; offset < normalized.length; offset += maxBatch) metrics.push(...await runGpuBatch(device, normalized.slice(offset, offset + maxBatch), normalizedGrid, shaderSource));
        const parity = JSON.stringify(metrics) === JSON.stringify(cpu.metrics);
        if (!parity) return unavailable('oracle-parity-mismatch', normalizedGrid, cpu);
        return Object.freeze({ schema: WEBGPU_FRONTIER_METRICS_SCHEMA, status: 'completed', backend: 'webgpu', metrics, candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, parity: 'verified' });
      } catch (error) { deviceCache.reset(); return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, normalizedGrid, cpu); }
    },
  });
}

export { SHADER as DEFAULT_SHADER };
