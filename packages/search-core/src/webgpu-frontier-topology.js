import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';
import { DEFAULT_FRONTIER_GRID } from './webgpu-frontier-validator.js';

export const WEBGPU_FRONTIER_TOPOLOGY_SCHEMA = 'tdotdh.webgpu-frontier-topology.v0';

const SHADER = `
struct Params {
  wordCount: u32,
  reserved0: u32,
  reserved1: u32,
  reserved2: u32,
};
@group(0) @binding(0) var<storage, read> parentMasks: array<u32>;
@group(0) @binding(1) var<storage, read> candidateMasks: array<u32>;
@group(0) @binding(2) var<storage, read_write> occupiedMasks: array<u32>;
@group(0) @binding(3) var<storage, read_write> area: atomic<u32>;
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.wordCount) { return; }
  let occupied = parentMasks[id.x] | candidateMasks[id.x];
  occupiedMasks[id.x] = occupied;
  atomicAdd(&area, countOneBits(occupied));
}`;

const LABEL_SHADER = `
struct Params {
  cellCount: u32,
  width: u32,
  height: u32,
  reserved0: u32,
};
@group(0) @binding(0) var<storage, read> occupiedMasks: array<u32>;
@group(0) @binding(1) var<storage, read> currentLabels: array<u32>;
@group(0) @binding(2) var<storage, read_write> nextLabels: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

fn occupiedAt(index: u32) -> bool {
  return ((occupiedMasks[index / 32u] >> (index % 32u)) & 1u) != 0u;
}

fn labelAt(x: i32, y: i32) -> u32 {
  if (x < 0 || y < 0 || x >= i32(params.width) || y >= i32(params.height)) { return 0u; }
  return currentLabels[u32(y) * params.width + u32(x)];
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.cellCount) { return; }
  let x = i32(id.x % params.width);
  let y = i32(id.x / params.width);
  var label = currentLabels[id.x];
  let activeOccupied = params.reserved0 != 0u;
  if (occupiedAt(id.x) != activeOccupied) { nextLabels[id.x] = 0u; return; }
  if (label == 0u) { nextLabels[id.x] = 0u; return; }
  if (labelAt(x + 1, y) != 0u) { label = min(label, labelAt(x + 1, y)); }
  if (labelAt(x - 1, y) != 0u) { label = min(label, labelAt(x - 1, y)); }
  if (labelAt(x, y + 1) != 0u) { label = min(label, labelAt(x, y + 1)); }
  if (labelAt(x, y - 1) != 0u) { label = min(label, labelAt(x, y - 1)); }
  nextLabels[id.x] = label;
}`;

const BATCH_REDUCTION_SHADER = `
struct Params {
  candidateCount: u32,
  wordCount: u32,
  reserved0: u32,
  reserved1: u32,
};
@group(0) @binding(0) var<storage, read> parentMasks: array<u32>;
@group(0) @binding(1) var<storage, read> candidateMasks: array<u32>;
@group(0) @binding(2) var<storage, read_write> occupiedMasks: array<u32>;
@group(0) @binding(3) var<storage, read_write> areas: array<atomic<u32>>;
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let totalWords = params.candidateCount * params.wordCount;
  if (id.x >= totalWords) { return; }
  let candidate = id.x / params.wordCount;
  let word = id.x % params.wordCount;
  let occupied = parentMasks[id.x] | candidateMasks[id.x];
  occupiedMasks[id.x] = occupied;
  atomicAdd(&areas[candidate], countOneBits(occupied));
}`;

const BATCH_LABEL_SHADER = `
struct Params {
  candidateCount: u32,
  cellCount: u32,
  width: u32,
  height: u32,
};
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
  if (label == 0u) { nextLabels[id.x] = 0u; return; }
  if (labelAt(candidate, x + 1, y) != 0u) { label = min(label, labelAt(candidate, x + 1, y)); }
  if (labelAt(candidate, x - 1, y) != 0u) { label = min(label, labelAt(candidate, x - 1, y)); }
  if (labelAt(candidate, x, y + 1) != 0u) { label = min(label, labelAt(candidate, x, y + 1)); }
  if (labelAt(candidate, x, y - 1) != 0u) { label = min(label, labelAt(candidate, x, y - 1)); }
  nextLabels[id.x] = label;
}`;

const DIRECTIONS = Object.freeze([
  Object.freeze({ x: 1, y: 0 }), Object.freeze({ x: -1, y: 0 }),
  Object.freeze({ x: 0, y: 1 }), Object.freeze({ x: 0, y: -1 }),
]);
const DIAGONALS = Object.freeze([
  Object.freeze({ x: 1, y: 1 }), Object.freeze({ x: 1, y: -1 }),
  Object.freeze({ x: -1, y: 1 }), Object.freeze({ x: -1, y: -1 }),
]);

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

function normalizeMask(mask, grid, label) {
  if (!Array.isArray(mask) && !(mask instanceof Uint32Array)) throw new TypeError(`${label} must be a uint32 word array`);
  if (mask.length !== grid.wordCount) throw new RangeError(`${label} must contain exactly ${grid.wordCount} words`);
  return Uint32Array.from(mask, word => {
    if (!Number.isSafeInteger(word) || word < 0 || word > 0xffffffff) throw new TypeError(`${label} contains a non-uint32 word`);
    return word;
  });
}

function bitAt(mask, grid, x, y) {
  const localX = x - grid.originX;
  const localY = y - grid.originY;
  if (localX < 0 || localX >= grid.width || localY < 0 || localY >= grid.height) return 0;
  const bit = localY * grid.width + localX;
  return (mask[Math.floor(bit / 32)] >>> (bit % 32)) & 1;
}

function setBit(mask, grid, x, y) {
  const bit = (y - grid.originY) * grid.width + (x - grid.originX);
  mask[Math.floor(bit / 32)] |= 1 << (bit % 32);
}

function occupiedCells(mask, grid) {
  const cells = [];
  for (let y = grid.originY; y < grid.originY + grid.height; y += 1) {
    for (let x = grid.originX; x < grid.originX + grid.width; x += 1) {
      if (bitAt(mask, grid, x, y)) cells.push({ x, y });
    }
  }
  return cells;
}

function inGrid(grid, x, y) {
  return x >= grid.originX && x < grid.originX + grid.width && y >= grid.originY && y < grid.originY + grid.height;
}

function key(x, y) {
  return `${x},${y}`;
}

function floodEmpty(start, occupied, grid, visited) {
  const queue = [start];
  visited.add(key(start.x, start.y));
  let size = 0;
  while (queue.length) {
    const cell = queue.pop();
    size += 1;
    for (const direction of DIRECTIONS) {
      const next = { x: cell.x + direction.x, y: cell.y + direction.y };
      if (inGrid(grid, next.x, next.y) && !occupied.has(key(next.x, next.y)) && !visited.has(key(next.x, next.y))) {
        visited.add(key(next.x, next.y));
        queue.push(next);
      }
    }
  }
  return size;
}

function topologyMetrics(occupiedMask, centroidMask, grid) {
  const cells = occupiedCells(occupiedMask, grid);
  const occupied = new Set(cells.map(cell => key(cell.x, cell.y)));
  let perimeter = 0;
  for (const cell of cells) {
    for (const direction of DIRECTIONS) {
      if (!occupied.has(key(cell.x + direction.x, cell.y + direction.y))) perimeter += 1;
    }
  }

  let connected = false;
  if (cells.length) {
    const seen = new Set([key(cells[0].x, cells[0].y)]);
    const queue = [cells[0]];
    while (queue.length) {
      const cell = queue.pop();
      for (const direction of DIRECTIONS) {
        const next = { x: cell.x + direction.x, y: cell.y + direction.y };
        const nextKey = key(next.x, next.y);
        if (occupied.has(nextKey) && !seen.has(nextKey)) {
          seen.add(nextKey);
          queue.push(next);
        }
      }
    }
    connected = seen.size === cells.length;
  }

  const exterior = new Set();
  for (let y = grid.originY; y < grid.originY + grid.height; y += 1) {
    for (let x = grid.originX; x < grid.originX + grid.width; x += 1) {
      if (!occupied.has(key(x, y)) && (x === grid.originX || x === grid.originX + grid.width - 1 || y === grid.originY || y === grid.originY + grid.height - 1)) floodEmpty({ x, y }, occupied, grid, exterior);
    }
  }
  const emptyVisited = new Set(exterior);
  let holes = 0;
  for (let y = grid.originY; y < grid.originY + grid.height; y += 1) {
    for (let x = grid.originX; x < grid.originX + grid.width; x += 1) {
      if (!occupied.has(key(x, y)) && !emptyVisited.has(key(x, y))) {
        floodEmpty({ x, y }, occupied, grid, emptyVisited);
        holes += 1;
      }
    }
  }

  const centroidCells = occupiedCells(centroidMask, grid);
  let centroidEdgeCoast = false;
  let centroidCornerCoast = false;
  for (const cell of centroidCells) {
    if (DIRECTIONS.some(direction => !occupied.has(key(cell.x + direction.x, cell.y + direction.y)))) centroidEdgeCoast = true;
    if (DIAGONALS.some(direction => !occupied.has(key(cell.x + direction.x, cell.y + direction.y)))) centroidCornerCoast = true;
  }

  const bounds = cells.reduce((result, cell) => ({
    minX: Math.min(result.minX, cell.x), maxX: Math.max(result.maxX, cell.x),
    minY: Math.min(result.minY, cell.y), maxY: Math.max(result.maxY, cell.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const bboxArea = cells.length ? (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1) : 0;
  return Object.freeze({ area: cells.length, perimeter, holes, connected, centroidEdgeCoast, centroidCornerCoast, bboxArea });
}

function componentLabels(mask, grid, active) {
  const labels = new Uint32Array(grid.width * grid.height);
  for (let y = grid.originY; y < grid.originY + grid.height; y += 1) {
    for (let x = grid.originX; x < grid.originX + grid.width; x += 1) {
      const index = (y - grid.originY) * grid.width + (x - grid.originX);
      if (Boolean(bitAt(mask, grid, x, y)) === active) labels[index] = index + 1;
    }
  }
  for (let pass = 0; pass < labels.length; pass += 1) {
    let changed = false;
    for (let y = grid.originY; y < grid.originY + grid.height; y += 1) {
      for (let x = grid.originX; x < grid.originX + grid.width; x += 1) {
        const index = (y - grid.originY) * grid.width + (x - grid.originX);
        if (!labels[index]) continue;
        let next = labels[index];
        for (const direction of DIRECTIONS) {
          const neighborX = x + direction.x;
          const neighborY = y + direction.y;
          if (inGrid(grid, neighborX, neighborY) && Boolean(bitAt(mask, grid, neighborX, neighborY)) === active) {
            const neighbor = labels[(neighborY - grid.originY) * grid.width + (neighborX - grid.originX)];
            if (neighbor && neighbor < next) next = neighbor;
          }
        }
        if (next !== labels[index]) { labels[index] = next; changed = true; }
      }
    }
    if (!changed) break;
  }
  return labels;
}

function summarizeLabels(occupiedLabels, emptyLabels, grid = DEFAULT_FRONTIER_GRID) {
  const occupiedComponents = new Set(Array.from(occupiedLabels).filter(Boolean));
  const boundaryEmptyLabels = new Set();
  for (let index = 0; index < emptyLabels.length; index += 1) {
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    if (x === 0 || y === 0 || x === grid.width - 1 || y === grid.height - 1) {
      if (emptyLabels[index]) boundaryEmptyLabels.add(emptyLabels[index]);
    }
  }
  const holeLabels = new Set(Array.from(emptyLabels).filter(label => label && !boundaryEmptyLabels.has(label)));
  return Object.freeze({ occupiedComponentCount: occupiedComponents.size, holes: holeLabels.size });
}

function normalizeInput(input, grid) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('topology input must be an object');
  const parentMask = normalizeMask(input.parentMask, grid, 'parentMask');
  const candidateMask = normalizeMask(input.candidateMask, grid, 'candidateMask');
  const centroidMask = input.centroidMask == null ? new Uint32Array(grid.wordCount) : normalizeMask(input.centroidMask, grid, 'centroidMask');
  const occupiedMask = Uint32Array.from(parentMask, (word, index) => word | candidateMask[index]);
  return Object.freeze({ parentMask, candidateMask, centroidMask, occupiedMask });
}

function sameMask(left, right) {
  return left?.length === right?.length && left.every((value, index) => value === right[index]);
}

function unavailable(reason, metrics) {
  return Object.freeze({ schema: WEBGPU_FRONTIER_TOPOLOGY_SCHEMA, status: 'fallback', backend: 'cpu-oracle', reason: String(reason), metrics });
}

function gpuBufferUsage() {
  return globalThis.GPUBufferUsage;
}

function gpuMapMode() {
  return globalThis.GPUMapMode;
}

async function runWebGpuReduction(deviceCache, normalized, grid, shaderSource) {
  const device = await deviceCache.getDevice();
  const usage = gpuBufferUsage();
  const mapMode = gpuMapMode();
  const byteLength = grid.wordCount * 4;
  const parentBuffer = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_DST });
  const candidateBuffer = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_DST });
  const occupiedBuffer = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_SRC });
  const areaBuffer = device.createBuffer({ size: 4, usage: usage.STORAGE | usage.COPY_SRC | usage.COPY_DST });
  const paramsBuffer = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST });
  const occupiedReadback = device.createBuffer({ size: byteLength, usage: usage.MAP_READ | usage.COPY_DST });
  const areaReadback = device.createBuffer({ size: 4, usage: usage.MAP_READ | usage.COPY_DST });
  try {
    device.queue.writeBuffer(parentBuffer, 0, normalized.parentMask);
    device.queue.writeBuffer(candidateBuffer, 0, normalized.candidateMask);
    device.queue.writeBuffer(areaBuffer, 0, new Uint32Array([0]));
    device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([grid.wordCount, 0, 0, 0]));
    const module = device.createShaderModule({ code: shaderSource });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: parentBuffer } }, { binding: 1, resource: { buffer: candidateBuffer } },
      { binding: 2, resource: { buffer: occupiedBuffer } }, { binding: 3, resource: { buffer: areaBuffer } },
      { binding: 4, resource: { buffer: paramsBuffer } },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(grid.wordCount / 64)); pass.end();
    encoder.copyBufferToBuffer(occupiedBuffer, 0, occupiedReadback, 0, byteLength);
    encoder.copyBufferToBuffer(areaBuffer, 0, areaReadback, 0, 4);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await occupiedReadback.mapAsync(mapMode.READ);
    const occupiedMask = Array.from(new Uint32Array(occupiedReadback.getMappedRange().slice(0)));
    occupiedReadback.unmap();
    await areaReadback.mapAsync(mapMode.READ);
    const area = new Uint32Array(areaReadback.getMappedRange().slice(0))[0];
    areaReadback.unmap();
    const labelModule = device.createShaderModule({ code: LABEL_SHADER });
    const labelPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: labelModule, entryPoint: 'main' } });
    const labelByteLength = grid.width * grid.height * 4;
    const occupiedLabels = Uint32Array.from({ length: grid.width * grid.height }, (_, index) => (occupiedMask[Math.floor(index / 32)] >>> (index % 32)) & 1 ? index + 1 : 0);
    const emptyLabels = Uint32Array.from({ length: grid.width * grid.height }, (_, index) => (occupiedLabels[index] ? 0 : index + 1));
    const labelBuffers = [
      device.createBuffer({ size: labelByteLength, usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC }),
      device.createBuffer({ size: labelByteLength, usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC }),
    ];
    const labelReadbacks = [device.createBuffer({ size: labelByteLength, usage: usage.MAP_READ | usage.COPY_DST }), device.createBuffer({ size: labelByteLength, usage: usage.MAP_READ | usage.COPY_DST })];
    const labelParams = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST });
    const runLabels = async (initial, activeOccupied) => {
      device.queue.writeBuffer(labelBuffers[0], 0, initial);
      device.queue.writeBuffer(labelBuffers[1], 0, new Uint32Array(initial.length));
      device.queue.writeBuffer(labelParams, 0, new Uint32Array([grid.width * grid.height, grid.width, grid.height, activeOccupied ? 1 : 0]));
      let current = 0;
      const encoder = device.createCommandEncoder();
      for (let pass = 0; pass < grid.width + grid.height; pass += 1) {
        const compute = encoder.beginComputePass();
        const bindGroup = device.createBindGroup({ layout: labelPipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: occupiedBuffer } }, { binding: 1, resource: { buffer: labelBuffers[current] } },
          { binding: 2, resource: { buffer: labelBuffers[1 - current] } }, { binding: 3, resource: { buffer: labelParams } },
        ] });
        compute.setPipeline(labelPipeline); compute.setBindGroup(0, bindGroup); compute.dispatchWorkgroups(Math.ceil((grid.width * grid.height) / 64)); compute.end();
        current = 1 - current;
      }
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      const copyEncoder = device.createCommandEncoder();
      copyEncoder.copyBufferToBuffer(labelBuffers[current], 0, labelReadbacks[0], 0, labelByteLength);
      device.queue.submit([copyEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      await labelReadbacks[0].mapAsync(mapMode.READ);
      const labels = new Uint32Array(labelReadbacks[0].getMappedRange().slice(0));
      labelReadbacks[0].unmap();
      return labels;
    };
    const gpuOccupiedLabels = await runLabels(occupiedLabels, true);
    const gpuEmptyLabels = await runLabels(emptyLabels, false);
    for (const buffer of [...labelBuffers, ...labelReadbacks, labelParams]) buffer.destroy();
    const summary = summarizeLabels(gpuOccupiedLabels, gpuEmptyLabels, grid);
    return { occupiedMask, area, occupiedLabels: Array.from(gpuOccupiedLabels), emptyLabels: Array.from(gpuEmptyLabels), ...summary };
  } finally {
    for (const buffer of [parentBuffer, candidateBuffer, occupiedBuffer, areaBuffer, paramsBuffer, occupiedReadback, areaReadback]) buffer.destroy();
  }
}

async function runWebGpuBatchReduction(deviceCache, normalizedInputs, grid) {
  const candidateCount = normalizedInputs.length;
  const wordCount = grid.wordCount;
  const cellCount = grid.width * grid.height;
  const device = await deviceCache.getDevice();
  const usage = gpuBufferUsage();
  const mapMode = gpuMapMode();
  const wordByteLength = candidateCount * wordCount * 4;
  const cellByteLength = candidateCount * cellCount * 4;
  const flattenMasks = property => {
    const flat = new Uint32Array(candidateCount * wordCount);
    normalizedInputs.forEach((input, index) => flat.set(input[property], index * wordCount));
    return flat;
  };
  const parentMasks = flattenMasks('parentMask');
  const candidateMasks = flattenMasks('candidateMask');
  const parentBuffer = device.createBuffer({ size: wordByteLength, usage: usage.STORAGE | usage.COPY_DST });
  const candidateBuffer = device.createBuffer({ size: wordByteLength, usage: usage.STORAGE | usage.COPY_DST });
  const occupiedBuffer = device.createBuffer({ size: wordByteLength, usage: usage.STORAGE | usage.COPY_SRC });
  const areasBuffer = device.createBuffer({ size: candidateCount * 4, usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC });
  const paramsBuffer = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST });
  const occupiedReadback = device.createBuffer({ size: wordByteLength, usage: usage.MAP_READ | usage.COPY_DST });
  const areasReadback = device.createBuffer({ size: candidateCount * 4, usage: usage.MAP_READ | usage.COPY_DST });
  const labelResources = [];
  try {
    device.queue.writeBuffer(parentBuffer, 0, parentMasks);
    device.queue.writeBuffer(candidateBuffer, 0, candidateMasks);
    device.queue.writeBuffer(areasBuffer, 0, new Uint32Array(candidateCount));
    device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([candidateCount, wordCount, 0, 0]));
    const reductionModule = device.createShaderModule({ code: BATCH_REDUCTION_SHADER });
    const reductionPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: reductionModule, entryPoint: 'main' } });
    const reductionBindGroup = device.createBindGroup({ layout: reductionPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: parentBuffer } }, { binding: 1, resource: { buffer: candidateBuffer } },
      { binding: 2, resource: { buffer: occupiedBuffer } }, { binding: 3, resource: { buffer: areasBuffer } },
      { binding: 4, resource: { buffer: paramsBuffer } },
    ] });
    const reductionEncoder = device.createCommandEncoder();
    const reductionPass = reductionEncoder.beginComputePass();
    reductionPass.setPipeline(reductionPipeline); reductionPass.setBindGroup(0, reductionBindGroup); reductionPass.dispatchWorkgroups(Math.ceil((candidateCount * wordCount) / 64)); reductionPass.end();
    reductionEncoder.copyBufferToBuffer(occupiedBuffer, 0, occupiedReadback, 0, wordByteLength);
    reductionEncoder.copyBufferToBuffer(areasBuffer, 0, areasReadback, 0, candidateCount * 4);
    device.queue.submit([reductionEncoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await occupiedReadback.mapAsync(mapMode.READ);
    const occupiedFlat = Array.from(new Uint32Array(occupiedReadback.getMappedRange().slice(0)));
    occupiedReadback.unmap();
    await areasReadback.mapAsync(mapMode.READ);
    const areas = Array.from(new Uint32Array(areasReadback.getMappedRange().slice(0)));
    areasReadback.unmap();

    const labelModule = device.createShaderModule({ code: BATCH_LABEL_SHADER });
    const labelPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: labelModule, entryPoint: 'main' } });
    const labelBuffers = [
      device.createBuffer({ size: cellByteLength, usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC }),
      device.createBuffer({ size: cellByteLength, usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC }),
    ];
    const labelReadback = device.createBuffer({ size: cellByteLength, usage: usage.MAP_READ | usage.COPY_DST });
    const labelParams = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST });
    labelResources.push(...labelBuffers, labelReadback, labelParams);
    const initialLabels = active => Uint32Array.from({ length: candidateCount * cellCount }, (_, index) => {
      const candidate = Math.floor(index / cellCount);
      const cell = index % cellCount;
      const occupied = (occupiedFlat[candidate * wordCount + Math.floor(cell / 32)] >>> (cell % 32)) & 1;
      return Boolean(occupied) === active ? cell + 1 : 0;
    });
    const runBatchLabels = async initial => {
      device.queue.writeBuffer(labelBuffers[0], 0, initial);
      device.queue.writeBuffer(labelBuffers[1], 0, new Uint32Array(initial.length));
      device.queue.writeBuffer(labelParams, 0, new Uint32Array([candidateCount, cellCount, grid.width, grid.height]));
      let current = 0;
      const encoder = device.createCommandEncoder();
      const bindGroups = [
        device.createBindGroup({ layout: labelPipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: labelBuffers[0] } }, { binding: 1, resource: { buffer: labelBuffers[1] } }, { binding: 2, resource: { buffer: labelParams } },
        ] }),
        device.createBindGroup({ layout: labelPipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: labelBuffers[1] } }, { binding: 1, resource: { buffer: labelBuffers[0] } }, { binding: 2, resource: { buffer: labelParams } },
        ] }),
      ];
      for (let pass = 0; pass < grid.width + grid.height; pass += 1) {
        const compute = encoder.beginComputePass();
        compute.setPipeline(labelPipeline); compute.setBindGroup(0, bindGroups[current]); compute.dispatchWorkgroups(Math.ceil((candidateCount * cellCount) / 64)); compute.end();
        current = 1 - current;
      }
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      const copyEncoder = device.createCommandEncoder();
      copyEncoder.copyBufferToBuffer(labelBuffers[current], 0, labelReadback, 0, cellByteLength);
      device.queue.submit([copyEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      await labelReadback.mapAsync(mapMode.READ);
      const labels = Array.from(new Uint32Array(labelReadback.getMappedRange().slice(0)));
      labelReadback.unmap();
      return labels;
    };
    const occupiedLabels = await runBatchLabels(initialLabels(true));
    const emptyLabels = await runBatchLabels(initialLabels(false));
    return normalizedInputs.map((input, index) => {
      const wordStart = index * wordCount;
      const cellStart = index * cellCount;
      const occupiedMask = occupiedFlat.slice(wordStart, wordStart + wordCount);
      const candidateOccupiedLabels = occupiedLabels.slice(cellStart, cellStart + cellCount);
      const candidateEmptyLabels = emptyLabels.slice(cellStart, cellStart + cellCount);
      return { occupiedMask, area: areas[index], occupiedLabels: candidateOccupiedLabels, emptyLabels: candidateEmptyLabels, ...summarizeLabels(candidateOccupiedLabels, candidateEmptyLabels, grid) };
    });
  } finally {
    for (const buffer of [parentBuffer, candidateBuffer, occupiedBuffer, areasBuffer, paramsBuffer, occupiedReadback, areasReadback, ...labelResources]) buffer.destroy();
  }
}

export function cpuFrontierTopology(input, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid);
  const normalized = normalizeInput(input, normalizedGrid);
  return Object.freeze({
    schema: WEBGPU_FRONTIER_TOPOLOGY_SCHEMA,
    status: 'completed',
    backend: 'cpu-oracle',
    occupiedMask: Array.from(normalized.occupiedMask),
    metrics: topologyMetrics(normalized.occupiedMask, normalized.centroidMask, normalizedGrid),
  });
}

export function cpuTopologyReduction(input, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid);
  const normalized = normalizeInput(input, normalizedGrid);
  const occupiedLabels = componentLabels(normalized.occupiedMask, normalizedGrid, true);
  const emptyLabels = componentLabels(normalized.occupiedMask, normalizedGrid, false);
  return Object.freeze({ occupiedMask: Array.from(normalized.occupiedMask), area: occupiedCells(normalized.occupiedMask, normalizedGrid).length, occupiedLabels: Array.from(occupiedLabels), emptyLabels: Array.from(emptyLabels), ...summarizeLabels(occupiedLabels, emptyLabels, normalizedGrid) });
}

export function createWebGpuFrontierTopology({ gpu = globalThis.navigator?.gpu, grid = DEFAULT_FRONTIER_GRID, requiredLimits = { maxStorageBufferBindingSize: 33554432 }, shaderSource = SHADER, accelerator = null, deviceCache = createWebGpuDeviceCache({ gpu, requiredLimits }) } = {}) {
  const normalizedGrid = normalizeGrid(grid);
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  let availabilityPromise = null;
  const availability = () => {
    if (availabilityPromise) return availabilityPromise;
    availabilityPromise = (async () => {
      if (typeof accelerator === 'function') return Object.freeze({ schema: WEBGPU_FRONTIER_TOPOLOGY_SCHEMA, status: 'available', backend: 'webgpu' });
      const probe = await probeWebGpuCapabilities({ gpu, requiredLimits });
      return probe.adapterAvailable && probe.requiredLimitsSatisfied
        ? Object.freeze({ schema: WEBGPU_FRONTIER_TOPOLOGY_SCHEMA, status: 'available', backend: 'webgpu' })
        : unavailable(probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable', null);
    })();
    return availabilityPromise;
  };
  const verifyAccelerated = (input, accelerated) => {
    const cpu = cpuFrontierTopology(input, normalizedGrid);
    const cpuReduction = cpuTopologyReduction(input, normalizedGrid);
    if (!sameMask(accelerated?.occupiedMask, cpuReduction.occupiedMask) || accelerated?.area !== cpuReduction.area || !sameMask(accelerated?.occupiedLabels, cpuReduction.occupiedLabels) || !sameMask(accelerated?.emptyLabels, cpuReduction.emptyLabels) || accelerated?.occupiedComponentCount !== cpuReduction.occupiedComponentCount || accelerated?.holes !== cpuReduction.holes) {
      return Object.freeze({ schema: WEBGPU_FRONTIER_TOPOLOGY_SCHEMA, status: 'rejected', backend: 'cpu-oracle', reason: 'topology-parity-mismatch', metrics: cpu.metrics, accelerator: { backend: 'webgpu', status: 'rejected' } });
    }
    const metrics = Object.freeze({ ...cpu.metrics, holes: accelerated.holes, connected: accelerated.occupiedComponentCount === 1 });
    return Object.freeze({ schema: WEBGPU_FRONTIER_TOPOLOGY_SCHEMA, status: 'completed', backend: 'webgpu', parity: 'labels-verified', metricsBackend: 'cpu-oracle-plus-gpu-labels', occupiedMask: cpu.occupiedMask, metrics, accelerator: { backend: 'webgpu', status: 'verified', area: accelerated.area, occupiedComponentCount: accelerated.occupiedComponentCount, holes: accelerated.holes } });
  };
  const evaluate = async input => {
    const cpu = cpuFrontierTopology(input, normalizedGrid);
    const normalized = normalizeInput(input, normalizedGrid);
    const availabilityReceipt = await availability();
    if (availabilityReceipt.status !== 'available') return unavailable(availabilityReceipt.reason, cpu.metrics);
    try {
      const accelerated = typeof accelerator === 'function'
        ? await accelerator(normalized, normalizedGrid)
        : await runWebGpuReduction(deviceCache, normalized, normalizedGrid, shaderSource);
      return verifyAccelerated(input, accelerated);
    } catch (error) {
      deviceCache.reset();
      return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, cpu.metrics);
    }
  };
  const evaluateBatch = async inputs => {
    if (!Array.isArray(inputs) || !inputs.length) throw new TypeError('topology inputs must be a non-empty array');
    const availabilityReceipt = await availability();
    if (availabilityReceipt.status !== 'available') return Object.freeze({ schema: WEBGPU_FRONTIER_TOPOLOGY_SCHEMA, status: 'fallback', backend: 'cpu-oracle', reason: availabilityReceipt.reason, candidateCount: inputs.length, results: [] });
    let results;
    try {
      if (typeof accelerator === 'function') {
        results = await Promise.all(inputs.map(async input => verifyAccelerated(input, await accelerator(normalizeInput(input, normalizedGrid), normalizedGrid))));
      } else {
        const reductions = await runWebGpuBatchReduction(deviceCache, inputs.map(input => normalizeInput(input, normalizedGrid)), normalizedGrid);
        results = reductions.map((reduction, index) => verifyAccelerated(inputs[index], reduction));
      }
    } catch (error) {
      deviceCache.reset();
      return Object.freeze({ schema: WEBGPU_FRONTIER_TOPOLOGY_SCHEMA, status: 'fallback', backend: 'cpu-oracle', reason: `webgpu-batch-failed:${error?.message || String(error)}`, candidateCount: inputs.length, results: [] });
    }
    const verified = results.every(result => result?.status === 'completed' && ['verified', 'labels-verified'].includes(result.parity));
    return Object.freeze({
      schema: WEBGPU_FRONTIER_TOPOLOGY_SCHEMA,
      status: verified ? 'completed' : 'fallback',
      backend: verified ? 'webgpu' : 'cpu-oracle',
      parity: verified ? 'verified' : 'fallback',
      candidateCount: results.length,
      results,
    });
  };
  return Object.freeze({ availability, evaluate, evaluateBatch });
}

export { DEFAULT_FRONTIER_GRID };
