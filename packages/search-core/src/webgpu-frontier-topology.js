import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
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

async function runWebGpuReduction(gpu, normalized, grid, shaderSource, requiredLimits) {
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error('webgpu-adapter-unavailable');
  const device = await adapter.requestDevice({ requiredLimits });
  const usage = gpuBufferUsage();
  const mapMode = gpuMapMode();
  const byteLength = grid.wordCount * 4;
  const parentBuffer = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_DST });
  const candidateBuffer = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_DST });
  const occupiedBuffer = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_SRC });
  const areaBuffer = device.createBuffer({ size: 4, usage: usage.STORAGE | usage.COPY_SRC });
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
    return { occupiedMask, area };
  } finally {
    for (const buffer of [parentBuffer, candidateBuffer, occupiedBuffer, areaBuffer, paramsBuffer, occupiedReadback, areaReadback]) buffer.destroy();
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

export function createWebGpuFrontierTopology({ gpu = globalThis.navigator?.gpu, grid = DEFAULT_FRONTIER_GRID, requiredLimits = { maxStorageBufferBindingSize: 65536 }, shaderSource = SHADER, accelerator = null } = {}) {
  const normalizedGrid = normalizeGrid(grid);
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  return Object.freeze({
    async availability() {
      if (typeof accelerator === 'function') return Object.freeze({ schema: WEBGPU_FRONTIER_TOPOLOGY_SCHEMA, status: 'available', backend: 'webgpu' });
      const probe = await probeWebGpuCapabilities({ gpu, requiredLimits });
      return probe.adapterAvailable && probe.requiredLimitsSatisfied
        ? Object.freeze({ schema: WEBGPU_FRONTIER_TOPOLOGY_SCHEMA, status: 'available', backend: 'webgpu' })
        : unavailable(probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable', null);
    },
    async evaluate(input) {
      const cpu = cpuFrontierTopology(input, normalizedGrid);
      const normalized = normalizeInput(input, normalizedGrid);
      const availability = await this.availability();
      if (availability.status !== 'available') return unavailable(availability.reason, cpu.metrics);
      let accelerated;
      try {
        accelerated = typeof accelerator === 'function'
          ? await accelerator(normalized, normalizedGrid)
          : await runWebGpuReduction(gpu, normalized, normalizedGrid, shaderSource, requiredLimits);
      } catch (error) {
        return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, cpu.metrics);
      }
      if (!sameMask(accelerated?.occupiedMask, cpu.occupiedMask) || accelerated?.area !== cpu.metrics.area) {
        return Object.freeze({ schema: WEBGPU_FRONTIER_TOPOLOGY_SCHEMA, status: 'rejected', backend: 'cpu-oracle', reason: 'topology-parity-mismatch', metrics: cpu.metrics, accelerator: { backend: 'webgpu', status: 'rejected' } });
      }
      return Object.freeze({ schema: WEBGPU_FRONTIER_TOPOLOGY_SCHEMA, status: 'completed', backend: 'webgpu', parity: 'verified', occupiedMask: cpu.occupiedMask, metrics: cpu.metrics, accelerator: { backend: 'webgpu', status: 'verified', area: accelerated.area } });
    },
  });
}

export { DEFAULT_FRONTIER_GRID };
