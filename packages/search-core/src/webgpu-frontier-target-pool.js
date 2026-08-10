import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { DEFAULT_FRONTIER_GRID } from './webgpu-frontier-validator.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_FRONTIER_TARGET_POOL_SCHEMA = 'tdotdh.webgpu-frontier-target-pool.v0';
export const FRONTIER_TARGET_POOL_WORKGROUP_SIZE = 64;

const DIRECTIONS = Object.freeze([{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]);
const SHADER = `
struct Params { batchCount: u32, cellCount: u32, wordCount: u32, width: u32, height: u32, originX: i32, originY: i32, reserved: u32, };
@group(0) @binding(0) var<storage, read> parentMasks: array<u32>;
@group(0) @binding(1) var<storage, read> centroidMasks: array<u32>;
@group(0) @binding(2) var<storage, read_write> frontierFlags: array<u32>;
@group(0) @binding(3) var<storage, read_write> ringFlags: array<u32>;
@group(0) @binding(4) var<uniform> params: Params;

fn parentAt(base: u32, offset: u32) -> bool {
  return ((parentMasks[base + offset / 32u] >> (offset % 32u)) & 1u) != 0u;
}
fn centroidAt(base: u32, offset: u32) -> bool {
  return ((centroidMasks[base + offset / 32u] >> (offset % 32u)) & 1u) != 0u;
}

@compute @workgroup_size(${FRONTIER_TARGET_POOL_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  let total = params.batchCount * params.cellCount;
  if (index >= total) { return; }
  let stateIndex = index / params.cellCount;
  let cellOffset = index % params.cellCount;
  let x = cellOffset % params.width;
  let y = cellOffset / params.width;
  if (parentAt(stateIndex * params.wordCount, cellOffset)) {
    frontierFlags[index] = 0u;
    ringFlags[index] = 0u;
    return;
  }
  var frontier = false;
  var ring = false;
  for (var direction = 0u; direction < 4u; direction++) {
    var nx = i32(x);
    var ny = i32(y);
    if (direction == 0u) { nx += 1; }
    if (direction == 1u) { nx -= 1; }
    if (direction == 2u) { ny += 1; }
    if (direction == 3u) { ny -= 1; }
    if (nx < 0 || nx >= i32(params.width) || ny < 0 || ny >= i32(params.height)) { continue; }
    let neighbor = u32(ny) * params.width + u32(nx);
    frontier = frontier || parentAt(stateIndex * params.wordCount, neighbor);
    ring = ring || centroidAt(stateIndex * params.wordCount, neighbor);
  }
  frontierFlags[index] = select(0u, 1u, frontier);
  ringFlags[index] = select(0u, 1u, ring);
}`;

function normalizeGrid(grid = DEFAULT_FRONTIER_GRID) {
  const value = { ...DEFAULT_FRONTIER_GRID, ...grid };
  for (const name of ['width', 'height']) if (!Number.isSafeInteger(value[name]) || value[name] <= 0 || value[name] > 128) throw new TypeError(`grid.${name} must be a positive safe integer at most 128`);
  for (const name of ['originX', 'originY']) if (!Number.isSafeInteger(value[name])) throw new TypeError(`grid.${name} must be a safe integer`);
  return Object.freeze({ width: value.width, height: value.height, originX: value.originX, originY: value.originY, wordCount: Math.ceil(value.width * value.height / 32), cellCount: value.width * value.height });
}

function normalizeCells(cells, label) {
  if (!Array.isArray(cells)) throw new TypeError(`${label} must be an array`);
  return cells.map((cell, index) => {
    if (!Number.isSafeInteger(cell?.x) || !Number.isSafeInteger(cell?.y)) throw new TypeError(`${label}[${index}] must contain safe integer x/y coordinates`);
    return { x: cell.x, y: cell.y };
  });
}

function inGrid(cell, grid) { return cell.x >= grid.originX && cell.x < grid.originX + grid.width && cell.y >= grid.originY && cell.y < grid.originY + grid.height; }
function key(x, y) { return `${x},${y}`; }
function createMask(cells, grid) {
  const mask = new Uint32Array(grid.wordCount);
  for (const cell of cells) if (inGrid(cell, grid)) {
    const offset = (cell.y - grid.originY) * grid.width + cell.x - grid.originX;
    mask[Math.floor(offset / 32)] |= 1 << (offset % 32);
  }
  return mask;
}

function cellsFromFlags(flags, stateIndex, grid) {
  const cells = [];
  const base = stateIndex * grid.cellCount;
  for (let offset = 0; offset < grid.cellCount; offset++) if (flags[base + offset]) cells.push({ x: grid.originX + (offset % grid.width), y: grid.originY + Math.floor(offset / grid.width) });
  return cells;
}

function flagsFromCells(cells, grid) {
  const flags = new Uint32Array(grid.cellCount), parent = new Set(cells.map(cell => key(cell.x, cell.y)));
  for (let offset = 0; offset < grid.cellCount; offset++) {
    const x = grid.originX + (offset % grid.width), y = grid.originY + Math.floor(offset / grid.width);
    if (parent.has(key(x, y))) continue;
    for (const direction of DIRECTIONS) if (parent.has(key(x + direction.x, y + direction.y))) { flags[offset] = 1; break; }
  }
  return flags;
}

function ringFlagsFromCells(cells, centroidCells, grid) {
  const flags = new Uint32Array(grid.cellCount), parent = new Set(cells.map(cell => key(cell.x, cell.y))), centroid = new Set(centroidCells.map(cell => key(cell.x, cell.y)));
  for (let offset = 0; offset < grid.cellCount; offset++) {
    const x = grid.originX + (offset % grid.width), y = grid.originY + Math.floor(offset / grid.width);
    if (parent.has(key(x, y))) continue;
    for (const direction of DIRECTIONS) if (centroid.has(key(x + direction.x, y + direction.y))) { flags[offset] = 1; break; }
  }
  return flags;
}

function normalizeBatch(inputs, grid) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new TypeError('frontier target pool batch must contain at least one input');
  return inputs.map((input, index) => Object.freeze({
    stateId: input?.stateId ?? index,
    fieldCells: normalizeCells(input?.fieldCells, `inputs[${index}].fieldCells`),
    centroidCells: normalizeCells(input?.centroidCells, `inputs[${index}].centroidCells`),
    grid,
  }));
}

export function cpuGenerateFrontierTargetPool(input, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid), normalized = normalizeBatch([input], normalizedGrid)[0];
  const frontierFlags = flagsFromCells(normalized.fieldCells, normalizedGrid), ringFlags = ringFlagsFromCells(normalized.fieldCells, normalized.centroidCells, normalizedGrid);
  return Object.freeze({ schema: WEBGPU_FRONTIER_TARGET_POOL_SCHEMA, status: 'completed', backend: 'cpu-oracle', parity: 'oracle', stateId: normalized.stateId, frontierCells: Object.freeze(cellsFromFlags(frontierFlags, 0, normalizedGrid)), ringCells: Object.freeze(cellsFromFlags(ringFlags, 0, normalizedGrid)), cellCount: normalizedGrid.cellCount });
}

export function cpuGenerateFrontierTargetPoolBatch(inputs, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid), normalized = normalizeBatch(inputs, normalizedGrid);
  return Object.freeze({ schema: WEBGPU_FRONTIER_TARGET_POOL_SCHEMA, status: 'completed', backend: 'cpu-oracle', parity: 'oracle', cellCount: normalizedGrid.cellCount, items: Object.freeze(normalized.map(input => cpuGenerateFrontierTargetPool(input, normalizedGrid))) });
}

function flattenMasks(inputs, property, grid) {
  const flat = new Uint32Array(inputs.length * grid.wordCount);
  inputs.forEach((input, index) => flat.set(createMask(input[property], grid), index * grid.wordCount));
  return flat;
}

function unavailable(reason, grid, cpu) {
  return Object.freeze({ ...cpu, schema: WEBGPU_FRONTIER_TARGET_POOL_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason), grid });
}

async function runGpu(device, inputs, grid, shaderSource) {
  const count = inputs.length, total = count * grid.cellCount, maskBytes = Math.max(4, count * grid.wordCount * 4), flagBytes = Math.max(4, total * 4);
  const parent = device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const centroid = device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const frontier = device.createBuffer({ size: flagBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const ring = device.createBuffer({ size: flagBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const frontierReadback = device.createBuffer({ size: flagBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const ringReadback = device.createBuffer({ size: flagBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(parent, 0, flattenMasks(inputs, 'fieldCells', grid));
    device.queue.writeBuffer(centroid, 0, flattenMasks(inputs, 'centroidCells', grid));
    device.queue.writeBuffer(params, 0, new Int32Array([count, grid.cellCount, grid.wordCount, grid.width, grid.height, grid.originX, grid.originY, 0]));
    const module = device.createShaderModule({ code: shaderSource }), pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } }), bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: parent } }, { binding: 1, resource: { buffer: centroid } }, { binding: 2, resource: { buffer: frontier } }, { binding: 3, resource: { buffer: ring } }, { binding: 4, resource: { buffer: params } }] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(total / FRONTIER_TARGET_POOL_WORKGROUP_SIZE)); pass.end(); encoder.copyBufferToBuffer(frontier, 0, frontierReadback, 0, flagBytes); encoder.copyBufferToBuffer(ring, 0, ringReadback, 0, flagBytes); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    await frontierReadback.mapAsync(GPUMapMode.READ); const frontierFlags = Array.from(new Uint32Array(frontierReadback.getMappedRange().slice(0, total * 4))); frontierReadback.unmap();
    await ringReadback.mapAsync(GPUMapMode.READ); const ringFlags = Array.from(new Uint32Array(ringReadback.getMappedRange().slice(0, total * 4))); ringReadback.unmap();
    return { frontierFlags, ringFlags };
  } finally { for (const buffer of [parent, centroid, frontier, ring, params, frontierReadback, ringReadback]) buffer.destroy(); }
}

export function createWebGpuFrontierTargetPool({ gpu = globalThis.navigator?.gpu, grid = DEFAULT_FRONTIER_GRID, requiredLimits = { maxComputeWorkgroupSizeX: FRONTIER_TARGET_POOL_WORKGROUP_SIZE }, shaderSource = SHADER, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  const normalizedGrid = normalizeGrid(grid), limits = { ...requiredLimits }; let availabilityPromise = null;
  const availability = async () => {
    if (!availabilityPromise) availabilityPromise = probeWebGpuCapabilities({ gpu, requiredLimits: limits }).then(probe => probe.adapterAvailable && probe.requiredLimitsSatisfied ? Object.freeze({ schema: WEBGPU_FRONTIER_TARGET_POOL_SCHEMA, status: 'available', backend: 'webgpu' }) : Object.freeze({ schema: WEBGPU_FRONTIER_TARGET_POOL_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable' }));
    return availabilityPromise;
  };
  return Object.freeze({
    availability,
    async generateBatch(inputs) {
      const normalized = normalizeBatch(inputs, normalizedGrid), cpu = cpuGenerateFrontierTargetPoolBatch(normalized, normalizedGrid), status = await availability();
      if (status.status !== 'available') return unavailable(status.reason, normalizedGrid, cpu);
      try {
        const device = await deviceCache.getDevice(), maxBinding = Number(device.limits?.maxStorageBufferBindingSize) || 0, requiredBytes = Math.max(normalized.length * normalizedGrid.wordCount * 4, normalized.length * normalizedGrid.cellCount * 4);
        if (maxBinding < requiredBytes) return unavailable('frontier-target-pool-storage-capacity', normalizedGrid, cpu);
        const result = await runGpu(device, normalized, normalizedGrid, shaderSource), items = normalized.map((input, index) => ({ schema: WEBGPU_FRONTIER_TARGET_POOL_SCHEMA, status: 'completed', backend: 'webgpu', parity: 'verified', stateId: input.stateId, frontierCells: cellsFromFlags(result.frontierFlags, index, normalizedGrid), ringCells: cellsFromFlags(result.ringFlags, index, normalizedGrid), cellCount: normalizedGrid.cellCount }));
        const parity = items.every((item, index) => JSON.stringify(item.frontierCells) === JSON.stringify(cpu.items[index].frontierCells) && JSON.stringify(item.ringCells) === JSON.stringify(cpu.items[index].ringCells));
        return parity ? Object.freeze({ schema: WEBGPU_FRONTIER_TARGET_POOL_SCHEMA, status: 'completed', backend: 'webgpu', parity: 'verified', cellCount: normalizedGrid.cellCount, items }) : unavailable('oracle-parity-mismatch', normalizedGrid, cpu);
      } catch (error) { deviceCache.reset(); return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, normalizedGrid, cpu); }
    },
  });
}

export { SHADER as DEFAULT_SHADER };
