import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { DEFAULT_FRONTIER_GRID } from './webgpu-frontier-validator.js';

export const WEBGPU_FRONTIER_GENERATOR_SCHEMA = 'tdotdh.webgpu-frontier-generator.v0';
export const MAX_FRONTIER_GENERATION_CANDIDATES = 16384;

const DIRECTIONS = Object.freeze([{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]);
const SHADER = `
struct Params {
  fieldCount: u32,
  pieceCount: u32,
  gridWidth: u32,
  gridHeight: u32,
  originX: i32,
  originY: i32,
  minX: i32,
  maxX: i32,
  minY: i32,
  maxY: i32,
  maxWidth: i32,
  maxHeight: i32,
};
@group(0) @binding(0) var<storage, read> fieldCells: array<i32>;
@group(0) @binding(1) var<storage, read> pieceCells: array<i32>;
@group(0) @binding(2) var<storage, read> fieldMask: array<u32>;
@group(0) @binding(3) var<storage, read_write> origins: array<i32>;
@group(0) @binding(4) var<storage, read_write> validity: array<u32>;
@group(0) @binding(5) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let candidateCount = params.fieldCount * 4u * params.pieceCount;
  if (id.x >= candidateCount) { return; }
  let perField = 4u * params.pieceCount;
  let fieldIndex = id.x / perField;
  let withinField = id.x % perField;
  let directionIndex = withinField / params.pieceCount;
  let sourceIndex = withinField % params.pieceCount;
  var dx: i32 = 0;
  var dy: i32 = 0;
  if (directionIndex == 0u) { dx = 1; }
  if (directionIndex == 1u) { dx = -1; }
  if (directionIndex == 2u) { dy = 1; }
  if (directionIndex == 3u) { dy = -1; }
  let targetX = fieldCells[fieldIndex * 2u] + dx;
  let targetY = fieldCells[fieldIndex * 2u + 1u] + dy;
  let originX = targetX - pieceCells[sourceIndex * 2u];
  let originY = targetY - pieceCells[sourceIndex * 2u + 1u];
  var valid = true;
  var nextMinX = params.minX;
  var nextMaxX = params.maxX;
  var nextMinY = params.minY;
  var nextMaxY = params.maxY;
  for (var pieceIndex: u32 = 0u; pieceIndex < params.pieceCount; pieceIndex++) {
    let x = originX + pieceCells[pieceIndex * 2u];
    let y = originY + pieceCells[pieceIndex * 2u + 1u];
    if (x < params.originX || x >= params.originX + i32(params.gridWidth) || y < params.originY || y >= params.originY + i32(params.gridHeight)) { valid = false; }
    if (x < nextMinX) { nextMinX = x; }
    if (x > nextMaxX) { nextMaxX = x; }
    if (y < nextMinY) { nextMinY = y; }
    if (y > nextMaxY) { nextMaxY = y; }
    if (x >= params.originX && x < params.originX + i32(params.gridWidth) && y >= params.originY && y < params.originY + i32(params.gridHeight)) {
      let bit = u32(y - params.originY) * params.gridWidth + u32(x - params.originX);
      if ((fieldMask[bit / 32u] & (1u << (bit % 32u))) != 0u) { valid = false; }
    }
  }
  if (nextMaxX - nextMinX + 1 > params.maxWidth || nextMaxY - nextMinY + 1 > params.maxHeight) { valid = false; }
  origins[id.x * 2u] = originX;
  origins[id.x * 2u + 1u] = originY;
  validity[id.x] = select(0u, 1u, valid);
}`;

function normalizeGrid(grid = DEFAULT_FRONTIER_GRID) {
  const value = { ...DEFAULT_FRONTIER_GRID, ...grid };
  for (const key of ['width', 'height']) if (!Number.isSafeInteger(value[key]) || value[key] <= 0 || value[key] > 128) throw new TypeError(`grid.${key} must be a positive safe integer at most 128`);
  for (const key of ['originX', 'originY']) if (!Number.isSafeInteger(value[key])) throw new TypeError(`grid.${key} must be a safe integer`);
  return Object.freeze({ width: value.width, height: value.height, originX: value.originX, originY: value.originY, wordCount: Math.ceil((value.width * value.height) / 32) });
}

function coordinate(value, label) { if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer`); return value; }
function normalizeCells(value, label, { maximum = 1024 } = {}) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) throw new TypeError(`${label} must contain 1-${maximum} cells`);
  return value.map((cell, index) => ({ x: coordinate(cell?.x, `${label}[${index}].x`), y: coordinate(cell?.y, `${label}[${index}].y`) }));
}
function normalizeBounds(value = {}) {
  const bounds = { minX: Number(value.minX), maxX: Number(value.maxX), minY: Number(value.minY), maxY: Number(value.maxY), maxWidth: 24, maxHeight: 16 };
  for (const key of ['minX', 'maxX', 'minY', 'maxY']) if (!Number.isSafeInteger(bounds[key])) throw new TypeError(`bounds.${key} must be a safe integer`);
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) throw new TypeError('bounds must have ordered limits');
  return Object.freeze(bounds);
}
function normalizeInput(input, grid) {
  const fieldCells = normalizeCells(input?.fieldCells, 'fieldCells');
  const pieceCells = normalizeCells(input?.pieceCells, 'pieceCells', { maximum: 64 });
  const bounds = normalizeBounds(input?.bounds);
  const candidateCount = fieldCells.length * DIRECTIONS.length * pieceCells.length;
  if (candidateCount > MAX_FRONTIER_GENERATION_CANDIDATES) throw new RangeError(`frontier generation exceeds ${MAX_FRONTIER_GENERATION_CANDIDATES} candidates`);
  return Object.freeze({ fieldCells, pieceCells, bounds, candidateCount, grid });
}

function inGrid(x, y, grid) { return x >= grid.originX && x < grid.originX + grid.width && y >= grid.originY && y < grid.originY + grid.height; }
function occupied(fieldSet, x, y) { return fieldSet.has(`${x},${y}`); }

export function cpuGenerateFrontierCandidates(input, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid), normalized = normalizeInput(input, normalizedGrid), fieldSet = new Set(normalized.fieldCells.map(cell => `${cell.x},${cell.y}`));
  const origins = [], validity = [];
  for (let fieldIndex = 0; fieldIndex < normalized.fieldCells.length; fieldIndex += 1) for (let directionIndex = 0; directionIndex < DIRECTIONS.length; directionIndex += 1) for (let sourceIndex = 0; sourceIndex < normalized.pieceCells.length; sourceIndex += 1) {
    const field = normalized.fieldCells[fieldIndex], direction = DIRECTIONS[directionIndex], source = normalized.pieceCells[sourceIndex];
    const origin = { x: field.x + direction.x - source.x, y: field.y + direction.y - source.y };
    let valid = true, minX = normalized.bounds.minX, maxX = normalized.bounds.maxX, minY = normalized.bounds.minY, maxY = normalized.bounds.maxY;
    for (const cell of normalized.pieceCells) {
      const x = origin.x + cell.x, y = origin.y + cell.y;
      if (!inGrid(x, y, normalizedGrid) || occupied(fieldSet, x, y)) valid = false;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (maxX - minX + 1 > 24 || maxY - minY + 1 > 16) valid = false;
    origins.push(origin); validity.push(valid ? 1 : 0);
  }
  return Object.freeze({ schema: WEBGPU_FRONTIER_GENERATOR_SCHEMA, status: 'completed', backend: 'cpu-oracle', origins, validity, acceptedIndices: validity.flatMap((value, index) => value ? [index] : []), candidateCount: normalized.candidateCount, parity: 'oracle' });
}

function flattenCells(cells) { const flat = new Int32Array(cells.length * 2); cells.forEach((cell, index) => { flat[index * 2] = cell.x; flat[index * 2 + 1] = cell.y; }); return flat; }
function createMask(cells, grid) { const mask = new Uint32Array(grid.wordCount); for (const cell of cells) { if (!inGrid(cell.x, cell.y, grid)) continue; const bit = (cell.y - grid.originY) * grid.width + (cell.x - grid.originX); mask[Math.floor(bit / 32)] |= 1 << (bit % 32); } return mask; }
function unavailable(reason, grid) { return Object.freeze({ schema: WEBGPU_FRONTIER_GENERATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason), grid }); }

async function runGpu(device, normalized, grid, shaderSource) {
  const fieldCells = flattenCells(normalized.fieldCells), pieceCells = flattenCells(normalized.pieceCells), fieldMask = createMask(normalized.fieldCells, grid);
  const count = normalized.candidateCount, originBytes = Math.max(4, count * 2 * 4), countBytes = Math.max(4, count * 4), fieldBytes = Math.max(4, fieldCells.byteLength), pieceBytes = Math.max(4, pieceCells.byteLength), maskBytes = Math.max(4, fieldMask.byteLength);
  const fieldBuffer = device.createBuffer({ size: fieldBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const pieceBuffer = device.createBuffer({ size: pieceBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const maskBuffer = device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const originsBuffer = device.createBuffer({ size: originBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const validityBuffer = device.createBuffer({ size: countBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const paramsBuffer = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const originsReadback = device.createBuffer({ size: originBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const validityReadback = device.createBuffer({ size: countBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(fieldBuffer, 0, fieldCells); device.queue.writeBuffer(pieceBuffer, 0, pieceCells); device.queue.writeBuffer(maskBuffer, 0, fieldMask);
    const params = new Int32Array([normalized.fieldCells.length, normalized.pieceCells.length, grid.width, grid.height, grid.originX, grid.originY, normalized.bounds.minX, normalized.bounds.maxX, normalized.bounds.minY, normalized.bounds.maxY, 24, 16]);
    device.queue.writeBuffer(paramsBuffer, 0, params);
    const module = device.createShaderModule({ code: shaderSource }), pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: fieldBuffer } }, { binding: 1, resource: { buffer: pieceBuffer } }, { binding: 2, resource: { buffer: maskBuffer } }, { binding: 3, resource: { buffer: originsBuffer } }, { binding: 4, resource: { buffer: validityBuffer } }, { binding: 5, resource: { buffer: paramsBuffer } },
    ] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end(); encoder.copyBufferToBuffer(originsBuffer, 0, originsReadback, 0, originBytes); encoder.copyBufferToBuffer(validityBuffer, 0, validityReadback, 0, countBytes); device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone(); await originsReadback.mapAsync(GPUMapMode.READ); const rawOrigins = Array.from(new Int32Array(originsReadback.getMappedRange().slice(0, count * 2 * 4))); originsReadback.unmap(); await validityReadback.mapAsync(GPUMapMode.READ); const validity = Array.from(new Uint32Array(validityReadback.getMappedRange().slice(0, count * 4))); validityReadback.unmap();
    return { origins: Array.from({ length: count }, (_, index) => ({ x: rawOrigins[index * 2], y: rawOrigins[index * 2 + 1] })), validity };
  } finally { for (const buffer of [fieldBuffer, pieceBuffer, maskBuffer, originsBuffer, validityBuffer, paramsBuffer, originsReadback, validityReadback]) buffer.destroy(); }
}

export function createWebGpuFrontierGenerator({ gpu = globalThis.navigator?.gpu, grid = DEFAULT_FRONTIER_GRID, requiredLimits = { maxStorageBufferBindingSize: 65536 }, shaderSource = SHADER } = {}) {
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  const normalizedGrid = normalizeGrid(grid), limits = { ...requiredLimits }; let availabilityPromise = null, devicePromise = null;
  const availability = async () => {
    if (!availabilityPromise) availabilityPromise = probeWebGpuCapabilities({ gpu, requiredLimits: limits }).then(probe => probe.adapterAvailable && probe.requiredLimitsSatisfied ? Object.freeze({ schema: WEBGPU_FRONTIER_GENERATOR_SCHEMA, status: 'available', backend: 'webgpu', grid: normalizedGrid }) : unavailable(probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable', normalizedGrid));
    return availabilityPromise;
  };
  return Object.freeze({
    availability,
    async generate(input) {
      const normalized = normalizeInput(input, normalizedGrid), cpu = cpuGenerateFrontierCandidates(normalized, normalizedGrid), status = await availability();
      if (status.status !== 'available') return Object.freeze({ ...status, origins: cpu.origins, validity: cpu.validity, acceptedIndices: cpu.acceptedIndices, candidateCount: cpu.candidateCount });
      let device;
      try {
        if (!devicePromise) devicePromise = gpu.requestAdapter().then(adapter => { if (!adapter) throw new Error('webgpu-adapter-unavailable'); return adapter.requestDevice(); }).catch(error => { devicePromise = null; throw error; });
        device = await devicePromise;
        const result = await runGpu(device, normalized, normalizedGrid, shaderSource), parity = JSON.stringify(result.origins) === JSON.stringify(cpu.origins) && JSON.stringify(result.validity) === JSON.stringify(cpu.validity);
        if (!parity) return Object.freeze({ schema: WEBGPU_FRONTIER_GENERATOR_SCHEMA, status: 'rejected', backend: 'webgpu', reason: 'oracle-parity-mismatch', origins: cpu.origins, validity: cpu.validity, acceptedIndices: cpu.acceptedIndices, candidateCount: cpu.candidateCount });
        return Object.freeze({ schema: WEBGPU_FRONTIER_GENERATOR_SCHEMA, status: 'completed', backend: 'webgpu', parity: 'verified', ...result, acceptedIndices: result.validity.flatMap((value, index) => value ? [index] : []), candidateCount: cpu.candidateCount });
      } catch (error) { devicePromise = null; return Object.freeze({ ...unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, normalizedGrid), origins: cpu.origins, validity: cpu.validity, acceptedIndices: cpu.acceptedIndices, candidateCount: cpu.candidateCount }); }
    },
  });
}

export { SHADER as DEFAULT_SHADER };
