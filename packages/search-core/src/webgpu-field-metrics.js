import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { DEFAULT_FRONTIER_GRID, createFrontierMaskFromCells } from './webgpu-frontier-validator.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';
import { createWebGpuPipelineCache } from './webgpu-pipeline-cache.js';

export const WEBGPU_FIELD_METRICS_SCHEMA = 'tdotdh.webgpu-field-metrics.v1';
export const FIELD_METRIC_COUNT = 16;

/*
 * This pass deliberately emits integer aggregates only.  The search oracle
 * owns floating-point policy (radius variance, quality weights, and family
 * naming), while the GPU owns the repeated occupancy scan over every branch.
 * That keeps the accelerated path deterministic across adapters.
 */
const SHADER = `
struct Params { candidateCount: u32, wordCount: u32, width: u32, height: u32, originX: i32, originY: i32, reserved0: u32, reserved1: u32 };
@group(0) @binding(0) var<storage, read> occupiedMasks: array<u32>;
@group(0) @binding(1) var<storage, read> centroidMasks: array<u32>;
@group(0) @binding(2) var<storage, read> outsideLabels: array<u32>;
@group(0) @binding(3) var<storage, read_write> outputMetrics: array<i32>;
@group(0) @binding(4) var<uniform> params: Params;

fn bitOffset(x: i32, y: i32) -> u32 {
  return u32(y - params.originY) * params.width + u32(x - params.originX);
}
fn occupiedBit(base: u32, x: i32, y: i32) -> u32 {
  if (x < params.originX || y < params.originY || x >= params.originX + i32(params.width) || y >= params.originY + i32(params.height)) { return 0u; }
  let offset = bitOffset(x, y);
  return (occupiedMasks[base + offset / 32u] >> (offset % 32u)) & 1u;
}
fn centroidBit(base: u32, x: i32, y: i32) -> u32 {
  if (x < params.originX || y < params.originY || x >= params.originX + i32(params.width) || y >= params.originY + i32(params.height)) { return 0u; }
  let offset = bitOffset(x, y);
  return (centroidMasks[base + offset / 32u] >> (offset % 32u)) & 1u;
}
fn outsideBit(candidate: u32, x: i32, y: i32) -> u32 {
  if (x < params.originX || y < params.originY || x >= params.originX + i32(params.width) || y >= params.originY + i32(params.height)) { return 0u; }
  let offset = bitOffset(x, y);
  return select(0u, 1u, outsideLabels[candidate * params.width * params.height + offset] != 0u);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.candidateCount) { return; }
  let candidate = id.x;
  let base = candidate * params.wordCount;
  var area: i32 = 0;
  var perimeter: i32 = 0;
  var minX: i32 = 2147483647;
  var maxX: i32 = -2147483647;
  var minY: i32 = 2147483647;
  var maxY: i32 = -2147483647;
  var sumX: i32 = 0;
  var sumY: i32 = 0;
  var centroidCount: i32 = 0;
  var centroidSumX: i32 = 0;
  var centroidSumY: i32 = 0;
  var centroidEdgeCoast: i32 = 0;
  var centroidCornerCoast: i32 = 0;
  var inletCells: i32 = 0;
  var inletEdges: i32 = 0;
  var holes: i32 = 0;
  for (var y: i32 = params.originY; y < params.originY + i32(params.height); y++) {
    for (var x: i32 = params.originX; x < params.originX + i32(params.width); x++) {
    let occupied = occupiedBit(base, x, y);
    let centroid = centroidBit(base, x, y);
    if (occupied == 1u) {
      area += 1;
      sumX += x;
      sumY += y;
      minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y);
      perimeter += i32(4u - occupiedBit(base, x + 1, y) - occupiedBit(base, x - 1, y) - occupiedBit(base, x, y + 1) - occupiedBit(base, x, y - 1));
    }
    if (centroid == 1u) {
      centroidCount += 1; centroidSumX += x; centroidSumY += y;
      if (occupiedBit(base, x + 1, y) == 0u || occupiedBit(base, x - 1, y) == 0u || occupiedBit(base, x, y + 1) == 0u || occupiedBit(base, x, y - 1) == 0u) { centroidEdgeCoast = 1; }
      for (var dx: i32 = -1; dx <= 1; dx++) {
        for (var dy: i32 = -1; dy <= 1; dy++) {
          if ((dx != 0 || dy != 0) && abs(dx) == 1 && abs(dy) == 1 && occupiedBit(base, x + dx, y + dy) == 0u) { centroidCornerCoast = 1; }
        }
      }
    }
    }
  }
  if (area == 0) { minX = 0; maxX = 0; minY = 0; maxY = 0; }
  for (var y: i32 = minY; y <= maxY; y++) {
    for (var x: i32 = minX; x <= maxX; x++) {
      if (occupiedBit(base, x, y) == 0u && outsideBit(candidate, x, y) == 0u) {
        holes += 1;
        var landNeighbors: i32 = 0;
        landNeighbors += i32(occupiedBit(base, x + 1, y)); landNeighbors += i32(occupiedBit(base, x - 1, y)); landNeighbors += i32(occupiedBit(base, x, y + 1)); landNeighbors += i32(occupiedBit(base, x, y - 1));
        if (landNeighbors >= 2) { inletCells += 1; inletEdges += landNeighbors; }
      }
    }
  }
  let output = id.x * ${FIELD_METRIC_COUNT}u;
  outputMetrics[output + 0u] = area;
  outputMetrics[output + 1u] = perimeter;
  outputMetrics[output + 2u] = minX;
  outputMetrics[output + 3u] = maxX;
  outputMetrics[output + 4u] = minY;
  outputMetrics[output + 5u] = maxY;
  outputMetrics[output + 6u] = sumX;
  outputMetrics[output + 7u] = sumY;
  outputMetrics[output + 8u] = centroidCount;
  outputMetrics[output + 9u] = centroidSumX;
  outputMetrics[output + 10u] = centroidSumY;
  outputMetrics[output + 11u] = centroidEdgeCoast;
  outputMetrics[output + 12u] = centroidCornerCoast;
  outputMetrics[output + 13u] = inletCells;
  outputMetrics[output + 14u] = inletEdges;
  outputMetrics[output + 15u] = holes;
}`;

const OUTSIDE_LABEL_SEED_SHADER = `
struct Params { candidateCount: u32, cellCount: u32, width: u32, height: u32 };
@group(0) @binding(0) var<storage, read> occupiedMasks: array<u32>;
@group(0) @binding(1) var<storage, read_write> labels: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let totalCells = params.candidateCount * params.cellCount;
  if (id.x >= totalCells) { return; }
  let candidate = id.x / params.cellCount;
  let cell = id.x % params.cellCount;
  let x = cell % params.width;
  let y = cell / params.width;
  let occupied = (occupiedMasks[candidate * ((params.cellCount + 31u) / 32u) + cell / 32u] >> (cell % 32u)) & 1u;
  let boundary = x == 0u || y == 0u || x + 1u == params.width || y + 1u == params.height;
  // Keep occupied cells distinguishable from unvisited empty cells. The
  // propagation pass must be able to fill empty cells from their neighbours
  // without allowing a label to cross through occupied land.
  labels[id.x] = select(0xffffffffu, select(0u, cell + 1u, boundary), occupied == 0u);
}`;

const OUTSIDE_LABEL_PROPAGATE_SHADER = `
struct Params { candidateCount: u32, cellCount: u32, width: u32, height: u32 };
@group(0) @binding(0) var<storage, read> currentLabels: array<u32>;
@group(0) @binding(1) var<storage, read_write> nextLabels: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

fn labelAt(candidate: u32, x: i32, y: i32) -> u32 {
  if (x < 0 || y < 0 || x >= i32(params.width) || y >= i32(params.height)) { return 0u; }
  return currentLabels[candidate * params.cellCount + u32(y) * params.width + u32(x)];
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let totalCells = params.candidateCount * params.cellCount;
  if (id.x >= totalCells) { return; }
  let candidate = id.x / params.cellCount;
  let cell = id.x % params.cellCount;
  let x = i32(cell % params.width);
  let y = i32(cell / params.width);
  var label = currentLabels[id.x];
  if (label == 0xffffffffu) { nextLabels[id.x] = 0xffffffffu; return; }
  let right = labelAt(candidate, x + 1, y); if (right != 0u && right != 0xffffffffu) { label = select(right, min(label, right), label != 0u); }
  let left = labelAt(candidate, x - 1, y); if (left != 0u && left != 0xffffffffu) { label = select(left, min(label, left), label != 0u); }
  let down = labelAt(candidate, x, y + 1); if (down != 0u && down != 0xffffffffu) { label = select(down, min(label, down), label != 0u); }
  let up = labelAt(candidate, x, y - 1); if (up != 0u && up != 0xffffffffu) { label = select(up, min(label, up), label != 0u); }
  nextLabels[id.x] = label;
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
  for (const word of mask) if (!Number.isSafeInteger(word) || word < 0 || word > 0xffffffff) throw new TypeError(`${label} contains a non-uint32 word`);
  return mask instanceof Uint32Array ? mask : Uint32Array.from(mask);
}

function normalizeCandidate(candidate, grid, index, { deriveOutsideMask = true } = {}) {
  if (!candidate || typeof candidate !== 'object') throw new TypeError(`field metric candidate ${index} must be an object`);
  const occupiedMask = normalizeMask(candidate.occupiedMask, grid.wordCount, `field metric candidate ${index}.occupiedMask`);
  return Object.freeze({
    occupiedMask,
    centroidMask: normalizeMask(candidate.centroidMask, grid.wordCount, `field metric candidate ${index}.centroidMask`),
    outsideMask: candidate.outsideMask == null
      ? (deriveOutsideMask ? outsideMaskFromOccupied(occupiedMask, grid) : null)
      : normalizeMask(candidate.outsideMask, grid.wordCount, `field metric candidate ${index}.outsideMask`),
  });
}

function bit(mask, grid, x, y) {
  const localX = x - grid.originX, localY = y - grid.originY;
  if (localX < 0 || localY < 0 || localX >= grid.width || localY >= grid.height) return 0;
  const offset = localY * grid.width + localX;
  return (mask[Math.floor(offset / 32)] >>> (offset % 32)) & 1;
}

const floodFillScratch = new Map();

function outsideMaskFromOccupied(occupiedMask, grid) {
  const outside = new Uint32Array(grid.wordCount), cellCount = grid.width * grid.height;
  // Candidate preparation runs once for every branch, so avoid strings,
  // objects, Set hashing, and repeated coordinate normalization. A flat
  // index queue keeps the same four-neighbor flood-fill semantics while
  // making the work data-oriented and allocation-light.
  let scratch = floodFillScratch.get(cellCount);
  if (!scratch) {
    scratch = { visited: new Uint8Array(cellCount), queue: new Int32Array(cellCount) };
    floodFillScratch.set(cellCount, scratch);
  }
  const { visited, queue } = scratch;
  visited.fill(0);
  let head = 0, tail = 0;
  const enqueue = (localX, localY) => {
    if (localX < 0 || localY < 0 || localX >= grid.width || localY >= grid.height) return;
    const offset = localY * grid.width + localX;
    if (visited[offset] || ((occupiedMask[offset >>> 5] >>> (offset & 31)) & 1)) return;
    visited[offset] = 1;
    queue[tail++] = offset;
  };
  for (let x = 0; x < grid.width; x++) { enqueue(x, 0); enqueue(x, grid.height - 1); }
  for (let y = 1; y < grid.height - 1; y++) { enqueue(0, y); enqueue(grid.width - 1, y); }
  while (head < tail) {
    const offset = queue[head++], localX = offset % grid.width, localY = Math.floor(offset / grid.width);
    outside[offset >>> 5] |= 1 << (offset & 31);
    enqueue(localX + 1, localY); enqueue(localX - 1, localY); enqueue(localX, localY + 1); enqueue(localX, localY - 1);
  }
  return outside;
}

function cpuMetric(candidate, grid) {
  let area = 0, perimeter = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, sumX = 0, sumY = 0, centroidCount = 0, centroidSumX = 0, centroidSumY = 0, centroidEdgeCoast = 0, centroidCornerCoast = 0;
  for (let y = grid.originY; y < grid.originY + grid.height; y++) for (let x = grid.originX; x < grid.originX + grid.width; x++) {
    const occupied = bit(candidate.occupiedMask, grid, x, y), centroid = bit(candidate.centroidMask, grid, x, y);
    if (occupied) { area++; sumX += x; sumY += y; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); perimeter += 4 - bit(candidate.occupiedMask, grid, x + 1, y) - bit(candidate.occupiedMask, grid, x - 1, y) - bit(candidate.occupiedMask, grid, x, y + 1) - bit(candidate.occupiedMask, grid, x, y - 1); }
    if (centroid) {
      centroidCount++; centroidSumX += x; centroidSumY += y;
      if (!bit(candidate.occupiedMask, grid, x + 1, y) || !bit(candidate.occupiedMask, grid, x - 1, y) || !bit(candidate.occupiedMask, grid, x, y + 1) || !bit(candidate.occupiedMask, grid, x, y - 1)) centroidEdgeCoast = 1;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if ((dx || dy) && Math.abs(dx) === 1 && Math.abs(dy) === 1 && !bit(candidate.occupiedMask, grid, x + dx, y + dy)) centroidCornerCoast = 1;
    }
  }
  let inletCells = 0, inletEdges = 0, holes = 0;
  if (area) for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (!bit(candidate.occupiedMask, grid, x, y)) {
    if (bit(candidate.outsideMask, grid, x, y)) continue;
    holes++;
    const landNeighbors = bit(candidate.occupiedMask, grid, x + 1, y) + bit(candidate.occupiedMask, grid, x - 1, y) + bit(candidate.occupiedMask, grid, x, y + 1) + bit(candidate.occupiedMask, grid, x, y - 1);
    if (landNeighbors >= 2) { inletCells++; inletEdges += landNeighbors; }
  }
  return [area, perimeter, Number.isFinite(minX) ? minX : 0, Number.isFinite(maxX) ? maxX : 0, Number.isFinite(minY) ? minY : 0, Number.isFinite(maxY) ? maxY : 0, sumX, sumY, centroidCount, centroidSumX, centroidSumY, centroidEdgeCoast, centroidCornerCoast, inletCells, inletEdges, holes];
}

function normalizeCandidates(candidates, grid, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) throw new TypeError('field metric candidates must be a non-empty array');
  return candidates.map((candidate, index) => normalizeCandidate(candidate, grid, index, options));
}

export function createFieldMetricsCandidate({ occupiedCells = [], centroidCells = [], outsideCells = null, occupiedMask = null, centroidMask = null, outsideMask = null, deferOutsideMask = false } = {}, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid);
  const takeMask = (mask, label) => mask instanceof Uint32Array && mask.length === normalizedGrid.wordCount ? mask : normalizeMask(mask, normalizedGrid.wordCount, label);
  const resolvedCentroidMask = centroidMask ? takeMask(centroidMask, 'centroidMask') : new Uint32Array(normalizedGrid.wordCount);
  if (!centroidMask && centroidCells?.length) resolvedCentroidMask.set(createFrontierMaskFromCells(centroidCells, normalizedGrid));
  const resolvedOccupiedMask = occupiedMask ? takeMask(occupiedMask, 'occupiedMask') : createFrontierMaskFromCells(occupiedCells, normalizedGrid);
  const resolvedOutsideMask = outsideMask ? takeMask(outsideMask, 'outsideMask') : outsideCells ? createFrontierMaskFromCells(outsideCells, normalizedGrid) : deferOutsideMask ? null : outsideMaskFromOccupied(resolvedOccupiedMask, normalizedGrid);
  return Object.freeze({ occupiedMask: resolvedOccupiedMask, centroidMask: resolvedCentroidMask, outsideMask: resolvedOutsideMask });
}

export function cpuEvaluateFieldMetrics(candidates, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid), normalized = normalizeCandidates(candidates, normalizedGrid);
  return Object.freeze({ schema: WEBGPU_FIELD_METRICS_SCHEMA, status: 'completed', backend: 'cpu-oracle', metrics: normalized.map(candidate => cpuMetric(candidate, normalizedGrid)), candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, parity: 'oracle' });
}

function unavailable(reason, grid, cpu) { return Object.freeze({ schema: WEBGPU_FIELD_METRICS_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason), grid, metrics: cpu.metrics, candidateCount: cpu.candidateCount, wordCount: cpu.wordCount, parity: 'oracle' }); }
function flatten(candidates, property, wordCount) { const flat = new Uint32Array(candidates.length * wordCount); candidates.forEach((candidate, index) => flat.set(candidate[property], index * wordCount)); return flat; }

async function runGpuBatch(device, normalized, grid, shaderSource, pipelineCache) {
  const count = normalized.length, maskBytes = Math.max(4, count * grid.wordCount * 4), outputBytes = Math.max(4, count * FIELD_METRIC_COUNT * 4);
  const cellCount = grid.width * grid.height, labelBytes = Math.max(4, count * cellCount * 4);
  const buffers = {
    occupied: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    centroid: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    outsideLabels: [
      device.createBuffer({ size: labelBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }),
      device.createBuffer({ size: labelBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }),
    ],
    output: device.createBuffer({ size: outputBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    params: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    readback: device.createBuffer({ size: outputBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    labelParams: device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
  };
  try {
    device.queue.writeBuffer(buffers.occupied, 0, flatten(normalized, 'occupiedMask', grid.wordCount)); device.queue.writeBuffer(buffers.centroid, 0, flatten(normalized, 'centroidMask', grid.wordCount));
    device.queue.writeBuffer(buffers.params, 0, new Int32Array([count, grid.wordCount, grid.width, grid.height, grid.originX, grid.originY, 0, 0]));
    const pipeline = pipelineCache.get(device, shaderSource);
    const seedPipeline = pipelineCache.get(device, OUTSIDE_LABEL_SEED_SHADER), propagatePipeline = pipelineCache.get(device, OUTSIDE_LABEL_PROPAGATE_SHADER);
    device.queue.writeBuffer(buffers.labelParams, 0, new Uint32Array([count, cellCount, grid.width, grid.height]));
    let current = 0;
    const encoder = device.createCommandEncoder();
    const seed = encoder.beginComputePass();
    seed.setPipeline(seedPipeline); seed.setBindGroup(0, device.createBindGroup({ layout: seedPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buffers.occupied } }, { binding: 1, resource: { buffer: buffers.outsideLabels[current] } }, { binding: 2, resource: { buffer: buffers.labelParams } }] })); seed.dispatchWorkgroups(Math.ceil(count * cellCount / 64)); seed.end();
    for (let pass = 0; pass < grid.width + grid.height; pass += 1) {
      const compute = encoder.beginComputePass();
      compute.setPipeline(propagatePipeline); compute.setBindGroup(0, device.createBindGroup({ layout: propagatePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buffers.outsideLabels[current] } }, { binding: 1, resource: { buffer: buffers.outsideLabels[1 - current] } }, { binding: 2, resource: { buffer: buffers.labelParams } }] })); compute.dispatchWorkgroups(Math.ceil(count * cellCount / 64)); compute.end(); current = 1 - current;
    }
    const metricBindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buffers.occupied } }, { binding: 1, resource: { buffer: buffers.centroid } }, { binding: 2, resource: { buffer: buffers.outsideLabels[current] } }, { binding: 3, resource: { buffer: buffers.output } }, { binding: 4, resource: { buffer: buffers.params } }] });
    const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, metricBindGroup); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end(); encoder.copyBufferToBuffer(buffers.output, 0, buffers.readback, 0, outputBytes); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone(); await buffers.readback.mapAsync(GPUMapMode.READ);
    const values = Array.from(new Int32Array(buffers.readback.getMappedRange().slice(0, count * FIELD_METRIC_COUNT * 4))); buffers.readback.unmap();
    return Array.from({ length: count }, (_, index) => values.slice(index * FIELD_METRIC_COUNT, (index + 1) * FIELD_METRIC_COUNT));
  } finally { Object.values(buffers).flatMap(buffer => Array.isArray(buffer) ? buffer : [buffer]).forEach(buffer => buffer.destroy()); }
}

export function createWebGpuFieldMetrics({ gpu = globalThis.navigator?.gpu, grid = DEFAULT_FRONTIER_GRID, requiredLimits = { maxStorageBufferBindingSize: 65536 }, shaderSource = SHADER, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  const normalizedGrid = normalizeGrid(grid), limits = { ...requiredLimits }, pipelineCache = createWebGpuPipelineCache();
  return Object.freeze({
    async availability() { const probe = await probeWebGpuCapabilities({ gpu, requiredLimits: limits }); if (!probe.adapterAvailable) return Object.freeze({ schema: WEBGPU_FIELD_METRICS_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: 'webgpu-adapter-unavailable', grid: normalizedGrid }); if (!probe.requiredLimitsSatisfied) return Object.freeze({ schema: WEBGPU_FIELD_METRICS_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: 'webgpu-required-limits-unsatisfied', grid: normalizedGrid }); return Object.freeze({ schema: WEBGPU_FIELD_METRICS_SCHEMA, status: 'available', backend: 'webgpu', grid: normalizedGrid }); },
    async evaluate(candidates, { verifyParity = true } = {}) {
      const status = await this.availability(), normalized = normalizeCandidates(candidates, normalizedGrid, { deriveOutsideMask: verifyParity });
      if (status.status !== 'available') return unavailable(status.reason, normalizedGrid, cpuEvaluateFieldMetrics(normalized, normalizedGrid));
      try {
        const device = await deviceCache.getDevice(), maxBinding = Number(device.limits?.maxStorageBufferBindingSize) || limits.maxStorageBufferBindingSize, maxBatch = Math.max(1, Math.floor(maxBinding / Math.max(normalizedGrid.wordCount * 8, 4))), metrics = [];
        for (let offset = 0; offset < normalized.length; offset += maxBatch) metrics.push(...await runGpuBatch(device, normalized.slice(offset, offset + maxBatch), normalizedGrid, shaderSource, pipelineCache));
        if (verifyParity) {
          const cpu = cpuEvaluateFieldMetrics(normalized, normalizedGrid);
          if (JSON.stringify(metrics) !== JSON.stringify(cpu.metrics)) return unavailable('oracle-parity-mismatch', normalizedGrid, cpu);
        }
        return Object.freeze({ schema: WEBGPU_FIELD_METRICS_SCHEMA, status: 'completed', backend: 'webgpu', metrics, candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, parity: verifyParity ? 'verified' : 'deferred' });
      } catch (error) {
        deviceCache.reset();
        return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, normalizedGrid, cpuEvaluateFieldMetrics(normalized, normalizedGrid));
      }
    },
  });
}

export { SHADER as DEFAULT_SHADER };
