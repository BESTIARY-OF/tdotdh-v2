import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { DEFAULT_FRONTIER_GRID } from './webgpu-frontier-validator.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';
import { createWebGpuFrontierBatchLayout } from './webgpu-frontier-batch-layout.js?v=20260810-layout3';

export const WEBGPU_FRONTIER_TARGET_GENERATOR_SCHEMA = 'tdotdh.webgpu-frontier-target-generator.v0';
export const MAX_FRONTIER_TARGET_GENERATION_CANDIDATES = 16384;
export const FRONTIER_TARGET_RECORD_STRIDE = 5;

const SHADER = `
struct Params {
  batchCount: u32,
  totalCandidateCount: u32,
  gridWidth: u32,
  gridHeight: u32,
  originX: i32,
  originY: i32,
  reserved0: u32,
  reserved1: u32,
};
struct Meta {
  targetCount: u32,
  targetOffset: u32,
  pieceOffset: u32,
  pieceCount: u32,
  fieldMaskOffset: u32,
  candidateOffset: u32,
  minX: i32,
  maxX: i32,
  minY: i32,
  maxY: i32,
  lockX: i32,
  lockY: i32,
  lockEnabled: u32,
  reserved: u32,
  reserved2: u32,
  reserved3: u32,
};
@group(0) @binding(0) var<storage, read> targetCells: array<i32>;
@group(0) @binding(1) var<storage, read> pieceCells: array<i32>;
@group(0) @binding(2) var<storage, read> fieldMasks: array<u32>;
@group(0) @binding(3) var<storage, read> metas: array<Meta>;
@group(0) @binding(4) var<storage, read_write> origins: array<i32>;
@group(0) @binding(5) var<storage, read_write> validity: array<u32>;
@group(0) @binding(6) var<uniform> params: Params;
@group(0) @binding(7) var<storage, read_write> records: array<i32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.totalCandidateCount) { return; }
  var selected = false;
  var targetOffset: u32 = 0u;
  var pieceOffset: u32 = 0u;
  var fieldMaskOffset: u32 = 0u;
  var targetCount: u32 = 0u;
  var pieceCount: u32 = 0u;
  var candidateOffset: u32 = 0u;
  var minX: i32 = 0;
  var maxX: i32 = 0;
  var minY: i32 = 0;
  var maxY: i32 = 0;
  var lockX: i32 = 0;
  var lockY: i32 = 0;
  var lockEnabled: u32 = 0u;
  for (var batchIndex: u32 = 0u; batchIndex < params.batchCount; batchIndex++) {
    let metadata = metas[batchIndex];
    if (!selected && id.x >= metadata.candidateOffset && id.x < metadata.candidateOffset + metadata.targetCount * metadata.pieceCount) {
      selected = true;
      targetOffset = metadata.targetOffset;
      pieceOffset = metadata.pieceOffset;
      fieldMaskOffset = metadata.fieldMaskOffset;
      targetCount = metadata.targetCount;
      pieceCount = metadata.pieceCount;
      candidateOffset = metadata.candidateOffset;
      minX = metadata.minX; maxX = metadata.maxX; minY = metadata.minY; maxY = metadata.maxY;
      lockX = metadata.lockX; lockY = metadata.lockY; lockEnabled = metadata.lockEnabled;
    }
  }
  if (!selected) { return; }
  let local = id.x - candidateOffset;
  let targetIndex = local / pieceCount;
  let sourceIndex = local % pieceCount;
  let targetBase = targetOffset + targetIndex * 2u;
  let sourceBase = pieceOffset + sourceIndex * 2u;
  let originX = targetCells[targetBase] - pieceCells[sourceBase];
  let originY = targetCells[targetBase + 1u] - pieceCells[sourceBase + 1u];
  var valid = true;
  if (lockEnabled != 0u && (originX != lockX || originY != lockY)) { valid = false; }
  var nextMinX = minX;
  var nextMaxX = maxX;
  var nextMinY = minY;
  var nextMaxY = maxY;
  for (var pieceIndex: u32 = 0u; pieceIndex < pieceCount; pieceIndex++) {
    let base = pieceOffset + pieceIndex * 2u;
    let x = originX + pieceCells[base];
    let y = originY + pieceCells[base + 1u];
    if (x < params.originX || x >= params.originX + i32(params.gridWidth) || y < params.originY || y >= params.originY + i32(params.gridHeight)) { valid = false; }
    if (x < nextMinX) { nextMinX = x; }
    if (x > nextMaxX) { nextMaxX = x; }
    if (y < nextMinY) { nextMinY = y; }
    if (y > nextMaxY) { nextMaxY = y; }
    if (x >= params.originX && x < params.originX + i32(params.gridWidth) && y >= params.originY && y < params.originY + i32(params.gridHeight)) {
      let bit = u32(y - params.originY) * params.gridWidth + u32(x - params.originX);
      if ((fieldMasks[fieldMaskOffset + bit / 32u] & (1u << (bit % 32u))) != 0u) { valid = false; }
    }
  }
  if (nextMaxX - nextMinX + 1 > 24 || nextMaxY - nextMinY + 1 > 16) { valid = false; }
  origins[id.x * 2u] = originX;
  origins[id.x * 2u + 1u] = originY;
  validity[id.x] = select(0u, 1u, valid);
  let recordBase = id.x * ${FRONTIER_TARGET_RECORD_STRIDE}u;
  records[recordBase] = i32(batchIndex);
  records[recordBase + 1u] = i32(targetIndex);
  records[recordBase + 2u] = originX;
  records[recordBase + 3u] = originY;
  records[recordBase + 4u] = i32(id.x);
}`;

function normalizeGrid(grid = DEFAULT_FRONTIER_GRID) {
  const value = { ...DEFAULT_FRONTIER_GRID, ...grid };
  for (const key of ['width', 'height']) if (!Number.isSafeInteger(value[key]) || value[key] <= 0 || value[key] > 128) throw new TypeError(`grid.${key} must be a positive safe integer at most 128`);
  for (const key of ['originX', 'originY']) if (!Number.isSafeInteger(value[key])) throw new TypeError(`grid.${key} must be a safe integer`);
  return Object.freeze({ width: value.width, height: value.height, originX: value.originX, originY: value.originY, wordCount: Math.ceil((value.width * value.height) / 32) });
}

function coordinate(value, label) { if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer`); return value; }
function normalizeCells(value, label, maximum) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) throw new TypeError(`${label} must contain 1-${maximum} cells`);
  return value.map((cell, index) => ({ x: coordinate(cell?.x, `${label}[${index}].x`), y: coordinate(cell?.y, `${label}[${index}].y`) }));
}
function normalizeBounds(value = {}) {
  const bounds = { minX: Number(value.minX), maxX: Number(value.maxX), minY: Number(value.minY), maxY: Number(value.maxY) };
  for (const key of ['minX', 'maxX', 'minY', 'maxY']) if (!Number.isSafeInteger(bounds[key])) throw new TypeError(`bounds.${key} must be a safe integer`);
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) throw new TypeError('bounds must have ordered limits');
  return Object.freeze(bounds);
}
function normalizeLock(value) {
  if (value == null) return Object.freeze({ enabled: 0, x: 0, y: 0 });
  return Object.freeze({ enabled: 1, x: coordinate(value.x, 'lockedOrigin.x'), y: coordinate(value.y, 'lockedOrigin.y') });
}
function normalizeInput(input, grid) {
  const fieldCells = normalizeCells(input?.fieldCells, 'fieldCells', 1024), targetCells = normalizeCells(input?.targetCells, 'targetCells', 1024), pieceCells = normalizeCells(input?.pieceCells, 'pieceCells', 64), bounds = normalizeBounds(input?.bounds), lock = normalizeLock(input?.lockedOrigin);
  const candidateCount = targetCells.length * pieceCells.length;
  if (candidateCount > MAX_FRONTIER_TARGET_GENERATION_CANDIDATES) throw new RangeError(`frontier target generation exceeds ${MAX_FRONTIER_TARGET_GENERATION_CANDIDATES} candidates`);
  return Object.freeze({ fieldCells, targetCells, pieceCells, bounds, lock, candidateCount, grid });
}
function normalizeBatchInput(inputs, grid) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new TypeError('frontier target generation batch must contain at least one input');
  let candidateOffset = 0;
  const items = inputs.map((input, index) => {
    const normalized = normalizeInput(input, grid), item = Object.freeze({ ...normalized, pieceId: input?.pieceId ?? index, candidateOffset });
    candidateOffset += normalized.candidateCount;
    return item;
  });
  if (candidateOffset > MAX_FRONTIER_TARGET_GENERATION_CANDIDATES) throw new RangeError(`frontier target generation batch exceeds ${MAX_FRONTIER_TARGET_GENERATION_CANDIDATES} candidates`);
  return Object.freeze({ items: Object.freeze(items), candidateCount: candidateOffset });
}
function inGrid(x, y, grid) { return x >= grid.originX && x < grid.originX + grid.width && y >= grid.originY && y < grid.originY + grid.height; }
function cpuCandidate(normalized, targetIndex, sourceIndex) {
  const target = normalized.targetCells[targetIndex], source = normalized.pieceCells[sourceIndex], origin = { x: target.x - source.x, y: target.y - source.y }, field = new Set(normalized.fieldCells.map(cell => `${cell.x},${cell.y}`));
  let valid = normalized.lock.enabled === 0 || (origin.x === normalized.lock.x && origin.y === normalized.lock.y);
  let minX = normalized.bounds.minX, maxX = normalized.bounds.maxX, minY = normalized.bounds.minY, maxY = normalized.bounds.maxY;
  for (const cell of normalized.pieceCells) {
    const x = origin.x + cell.x, y = origin.y + cell.y;
    if (!inGrid(x, y, normalized.grid) || field.has(`${x},${y}`)) valid = false;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX - minX + 1 > 24 || maxY - minY + 1 > 16) valid = false;
  return { origin, valid: valid ? 1 : 0 };
}
function cpuGenerateFrontierTargetCandidatesNormalized(normalized) {
  const origins = [], validity = [];
  for (let targetIndex = 0; targetIndex < normalized.targetCells.length; targetIndex += 1) for (let sourceIndex = 0; sourceIndex < normalized.pieceCells.length; sourceIndex += 1) {
    const result = cpuCandidate(normalized, targetIndex, sourceIndex); origins.push(result.origin); validity.push(result.valid);
  }
  return Object.freeze({ schema: WEBGPU_FRONTIER_TARGET_GENERATOR_SCHEMA, status: 'completed', backend: 'cpu-oracle', targetCount: normalized.targetCells.length, pieceCount: normalized.pieceCells.length, origins, validity, acceptedIndices: validity.flatMap((value, index) => value ? [index] : []), candidateCount: normalized.candidateCount, parity: 'oracle' });
}
export function cpuGenerateFrontierTargetCandidates(input, grid = DEFAULT_FRONTIER_GRID) {
  return cpuGenerateFrontierTargetCandidatesNormalized(normalizeInput(input, normalizeGrid(grid)));
}
export function cpuGenerateFrontierTargetBatch(inputs, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid), normalized = normalizeBatchInput(inputs, normalizedGrid);
  return Object.freeze({ schema: WEBGPU_FRONTIER_TARGET_GENERATOR_SCHEMA, status: 'completed', backend: 'cpu-oracle', parity: 'oracle', candidateCount: normalized.candidateCount, items: Object.freeze(normalized.items.map(item => Object.freeze({ pieceId: item.pieceId, targetCount: item.targetCells.length, pieceCount: item.pieceCells.length, ...cpuGenerateFrontierTargetCandidatesNormalized(item) }))) });
}

function parityMismatchReason(actualItems, expectedItems) {
  if (actualItems.length !== expectedItems.length) return `oracle-parity-mismatch:item-count:${actualItems.length}/${expectedItems.length}`;
  for (let itemIndex = 0; itemIndex < expectedItems.length; itemIndex += 1) {
    const actual = actualItems[itemIndex], expected = expectedItems[itemIndex];
    if (actual.origins.length !== expected.origins.length) return `oracle-parity-mismatch:item-${itemIndex}:origin-count:${actual.origins.length}/${expected.origins.length}`;
    if (actual.validity.length !== expected.validity.length) return `oracle-parity-mismatch:item-${itemIndex}:validity-count:${actual.validity.length}/${expected.validity.length}`;
    for (let index = 0; index < expected.origins.length; index += 1) {
      const actualOrigin = actual.origins[index], expectedOrigin = expected.origins[index];
      if (actualOrigin.x !== expectedOrigin.x || actualOrigin.y !== expectedOrigin.y) return `oracle-parity-mismatch:item-${itemIndex}:origin-${index}:gpu-${actualOrigin.x},${actualOrigin.y}:cpu-${expectedOrigin.x},${expectedOrigin.y}`;
      if (actual.validity[index] !== expected.validity[index]) return `oracle-parity-mismatch:item-${itemIndex}:validity-${index}:gpu-${actual.validity[index]}:cpu-${expected.validity[index]}`;
    }
  }
  return 'oracle-parity-mismatch';
}

async function runGpuBatch(device, normalized, grid, shaderSource) {
  const layout = createWebGpuFrontierBatchLayout(normalized.items, grid);
  const originBytes = Math.max(4, normalized.candidateCount * 2 * 4), countBytes = Math.max(4, normalized.candidateCount * 4), targetBytes = Math.max(4, layout.targetValues.byteLength), pieceBytes = Math.max(4, layout.pieceValues.byteLength), maskBytes = Math.max(4, layout.fieldMasks.byteLength), metaBytes = Math.max(4, layout.metaValues.byteLength);
  const buffers = {
    targets: device.createBuffer({ size: targetBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    pieces: device.createBuffer({ size: pieceBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    masks: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    metas: device.createBuffer({ size: metaBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    origins: device.createBuffer({ size: originBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    validity: device.createBuffer({ size: countBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    records: device.createBuffer({ size: Math.max(4, normalized.candidateCount * FRONTIER_TARGET_RECORD_STRIDE * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    params: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    originsReadback: device.createBuffer({ size: originBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    validityReadback: device.createBuffer({ size: countBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
  };
  try {
    device.queue.writeBuffer(buffers.targets, 0, layout.targetValues); device.queue.writeBuffer(buffers.pieces, 0, layout.pieceValues); device.queue.writeBuffer(buffers.masks, 0, layout.fieldMasks); device.queue.writeBuffer(buffers.metas, 0, layout.metaValues); device.queue.writeBuffer(buffers.params, 0, new Int32Array([layout.itemCount, layout.candidateCount, grid.width, grid.height, grid.originX, grid.originY, 0, 0]));
    const module = device.createShaderModule({ code: shaderSource }), pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } }), bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [0, 1, 2, 3, 4, 5, 6, 7].map((binding, index) => ({ binding, resource: { buffer: [buffers.targets, buffers.pieces, buffers.masks, buffers.metas, buffers.origins, buffers.validity, buffers.params, buffers.records][index] } })) });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(normalized.candidateCount / 64)); pass.end(); encoder.copyBufferToBuffer(buffers.origins, 0, buffers.originsReadback, 0, originBytes); encoder.copyBufferToBuffer(buffers.validity, 0, buffers.validityReadback, 0, countBytes); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    await buffers.originsReadback.mapAsync(GPUMapMode.READ); const rawOrigins = Array.from(new Int32Array(buffers.originsReadback.getMappedRange().slice(0, normalized.candidateCount * 2 * 4))); buffers.originsReadback.unmap(); await buffers.validityReadback.mapAsync(GPUMapMode.READ); const validity = Array.from(new Uint32Array(buffers.validityReadback.getMappedRange().slice(0, normalized.candidateCount * 4))); buffers.validityReadback.unmap();
    return normalized.items.map(item => { const start = item.candidateOffset, origins = Array.from({ length: item.candidateCount }, (_, index) => ({ x: rawOrigins[(start + index) * 2], y: rawOrigins[(start + index) * 2 + 1] })), itemValidity = validity.slice(start, start + item.candidateCount); return { pieceId: item.pieceId, targetCount: item.targetCells.length, pieceCount: item.pieceCells.length, origins, validity: itemValidity, candidateCount: item.candidateCount }; });
  } finally { Object.values(buffers).forEach(buffer => buffer.destroy()); }
}

function nextCapacity(required) {
  let capacity = 1;
  while (capacity < required) capacity *= 2;
  return capacity;
}

function createPersistentGpuTargetRunner(device, grid, shaderSource) {
  const usage = globalThis.GPUBufferUsage, mapMode = globalThis.GPUMapMode;
  let resources = null, retiredResources = [], dispatchCount = 0;
  const destroyResources = bundle => { if (bundle) for (const buffer of Object.values(bundle.buffers)) buffer.destroy(); };
  const destroy = () => {
    destroyResources(resources);
    retiredResources.forEach(destroyResources);
    resources = null;
    retiredResources = [];
  };
  const ensure = (normalized) => {
    const layout = createWebGpuFrontierBatchLayout(normalized.items, grid);
    const rows = nextCapacity(Math.max(1, normalized.candidateCount));
    const items = nextCapacity(Math.max(1, normalized.items.length));
    const targets = nextCapacity(Math.max(1, layout.targetValues.length));
    const pieces = nextCapacity(Math.max(1, layout.pieceValues.length));
    const masks = nextCapacity(Math.max(1, layout.fieldMasks.length));
    const metas = nextCapacity(Math.max(1, layout.metaValues.length));
    if (resources && resources.rowCapacity >= rows && resources.itemCapacity >= items && resources.targetCapacity >= targets && resources.pieceCapacity >= pieces && resources.maskCapacity >= masks && resources.metaCapacity >= metas) return { resources, layout };
    const originBytes = Math.max(4, rows * 2 * 4), countBytes = Math.max(4, rows * 4), recordBytes = Math.max(4, rows * FRONTIER_TARGET_RECORD_STRIDE * 4);
    const buffers = {
      targets: device.createBuffer({ size: Math.max(4, targets * 4), usage: usage.STORAGE | usage.COPY_DST }),
      pieces: device.createBuffer({ size: Math.max(4, pieces * 4), usage: usage.STORAGE | usage.COPY_DST }),
      masks: device.createBuffer({ size: Math.max(4, masks * 4), usage: usage.STORAGE | usage.COPY_DST }),
      metas: device.createBuffer({ size: Math.max(4, metas * 4), usage: usage.STORAGE | usage.COPY_DST }),
      origins: device.createBuffer({ size: originBytes, usage: usage.STORAGE | usage.COPY_SRC }),
      validity: device.createBuffer({ size: countBytes, usage: usage.STORAGE | usage.COPY_SRC }),
      params: device.createBuffer({ size: 32, usage: usage.UNIFORM | usage.COPY_DST }),
      records: device.createBuffer({ size: recordBytes, usage: usage.STORAGE | usage.COPY_SRC }),
      originsReadback: device.createBuffer({ size: originBytes, usage: usage.MAP_READ | usage.COPY_DST }),
      validityReadback: device.createBuffer({ size: countBytes, usage: usage.MAP_READ | usage.COPY_DST }),
    };
    try {
      const module = device.createShaderModule({ code: shaderSource });
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [0, 1, 2, 3, 4, 5, 6, 7].map((binding, index) => ({ binding, resource: { buffer: [buffers.targets, buffers.pieces, buffers.masks, buffers.metas, buffers.origins, buffers.validity, buffers.params, buffers.records][index] } })) });
      const next = { buffers, pipeline, bindGroup, rowCapacity: rows, itemCapacity: items, targetCapacity: targets, pieceCapacity: pieces, maskCapacity: masks, metaCapacity: metas };
      if (resources) retiredResources.push(resources);
      resources = next;
    } catch (error) {
      destroyResources({ buffers });
      throw error;
    }
    return { resources, layout };
  };
  return Object.freeze({
    reset: destroy,
    async run(normalized) {
      const current = ensure(normalized), { resources, layout } = current, { buffers } = resources;
      device.queue.writeBuffer(buffers.targets, 0, layout.targetValues); device.queue.writeBuffer(buffers.pieces, 0, layout.pieceValues); device.queue.writeBuffer(buffers.masks, 0, layout.fieldMasks); device.queue.writeBuffer(buffers.metas, 0, layout.metaValues); device.queue.writeBuffer(buffers.params, 0, new Int32Array([layout.itemCount, layout.candidateCount, grid.width, grid.height, grid.originX, grid.originY, 0, 0]));
      const originBytes = Math.max(4, normalized.candidateCount * 2 * 4), countBytes = Math.max(4, normalized.candidateCount * 4);
      const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(resources.pipeline); pass.setBindGroup(0, resources.bindGroup); pass.dispatchWorkgroups(Math.ceil(normalized.candidateCount / 64)); pass.end(); encoder.copyBufferToBuffer(buffers.origins, 0, buffers.originsReadback, 0, originBytes); encoder.copyBufferToBuffer(buffers.validity, 0, buffers.validityReadback, 0, countBytes); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
      await buffers.originsReadback.mapAsync(mapMode.READ); const rawOrigins = Array.from(new Int32Array(buffers.originsReadback.getMappedRange().slice(0, normalized.candidateCount * 2 * 4))); buffers.originsReadback.unmap(); await buffers.validityReadback.mapAsync(mapMode.READ); const validity = Array.from(new Uint32Array(buffers.validityReadback.getMappedRange().slice(0, normalized.candidateCount * 4))); buffers.validityReadback.unmap(); dispatchCount += 1;
      const items = normalized.items.map(item => { const start = item.candidateOffset, origins = Array.from({ length: item.candidateCount }, (_, index) => ({ x: rawOrigins[(start + index) * 2], y: rawOrigins[(start + index) * 2 + 1] })), itemValidity = validity.slice(start, start + item.candidateCount); return { pieceId: item.pieceId, targetCount: item.targetCells.length, pieceCount: item.pieceCells.length, origins, validity: itemValidity, candidateCount: item.candidateCount }; });
      return { items, persistent: true, dispatch: 'webgpu-frontier-target-resident', dispatchCount, residentHandle: Object.freeze({ schema: 'tdotdh.webgpu-frontier-target-records.v0', device, recordsBuffer: buffers.records, recordsOffsetBytes: 0, recordStrideBytes: FRONTIER_TARGET_RECORD_STRIDE * 4, validityBuffer: buffers.validity, validityOffsetBytes: 0, validityStrideBytes: 4, targetCellsBuffer: buffers.targets, targetCellsOffsetBytes: 0, targetCellsStrideBytes: 8, recordCount: normalized.candidateCount, itemCount: normalized.items.length, itemMetadata: Object.freeze(normalized.items.map((item, index) => Object.freeze({ itemOrdinal: index, pieceId: item.pieceId, targetCount: item.targetCells.length, targetOffset: layout.targetOffsets[index], pieceCount: item.pieceCells.length, candidateOffset: item.candidateOffset }))), generation: dispatchCount }), bufferCapacity: { rows: resources.rowCapacity, items: resources.itemCapacity, targets: resources.targetCapacity, pieces: resources.pieceCapacity, masks: resources.maskCapacity, metas: resources.metaCapacity } };
    },
  });
}
function unavailable(reason, grid) { return Object.freeze({ schema: WEBGPU_FRONTIER_TARGET_GENERATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason), grid }); }

export function createWebGpuFrontierTargetGenerator({ gpu = globalThis.navigator?.gpu, grid = DEFAULT_FRONTIER_GRID, requiredLimits = { maxStorageBufferBindingSize: 65536 }, shaderSource = SHADER, deviceCache = createWebGpuDeviceCache({ gpu }), persistent = true } = {}) {
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  const normalizedGrid = normalizeGrid(grid), limits = { ...requiredLimits }; let availabilityPromise = null, persistentRunner = null;
  const availability = async () => {
    if (!availabilityPromise) availabilityPromise = probeWebGpuCapabilities({ gpu, requiredLimits: limits }).then(probe => probe.adapterAvailable && probe.requiredLimitsSatisfied ? Object.freeze({ schema: WEBGPU_FRONTIER_TARGET_GENERATOR_SCHEMA, status: 'available', backend: 'webgpu', grid: normalizedGrid }) : unavailable(probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable', normalizedGrid));
    return availabilityPromise;
  };
  return Object.freeze({
    availability,
    async generate(input) {
      const normalized = normalizeBatchInput([input], normalizedGrid), cpu = cpuGenerateFrontierTargetBatch([input], normalizedGrid), status = await availability();
      if (status.status !== 'available') return Object.freeze({ ...status, targetCount: cpu.items[0].targetCount, pieceCount: cpu.items[0].pieceCount, origins: cpu.items[0].origins, validity: cpu.items[0].validity, acceptedIndices: cpu.items[0].acceptedIndices, candidateCount: cpu.candidateCount });
      try {
        const device = await deviceCache.getDevice();
        if (persistent && !persistentRunner) persistentRunner = createPersistentGpuTargetRunner(device, normalizedGrid, shaderSource);
        const resident = persistentRunner ? await persistentRunner.run(normalized) : null;
        const result = (resident || { items: await runGpuBatch(device, normalized, normalizedGrid, shaderSource) }).items[0], expected = cpu.items[0], parity = JSON.stringify(result.origins) === JSON.stringify(expected.origins) && JSON.stringify(result.validity) === JSON.stringify(expected.validity);
        if (!parity) return Object.freeze({ schema: WEBGPU_FRONTIER_TARGET_GENERATOR_SCHEMA, status: 'rejected', backend: 'webgpu', reason: parityMismatchReason([result], [expected]), targetCount: expected.targetCount, pieceCount: expected.pieceCount, origins: expected.origins, validity: expected.validity, acceptedIndices: expected.acceptedIndices, candidateCount: expected.candidateCount });
        return Object.freeze({ schema: WEBGPU_FRONTIER_TARGET_GENERATOR_SCHEMA, status: 'completed', backend: 'webgpu', parity: 'verified', targetCount: result.targetCount, pieceCount: result.pieceCount, origins: result.origins, validity: result.validity, acceptedIndices: result.validity.flatMap((value, index) => value ? [index] : []), candidateCount: result.candidateCount, ...(resident?.persistent ? { persistent: true, dispatch: resident.dispatch, dispatchCount: resident.dispatchCount, residentHandle: resident.residentHandle, bufferCapacity: resident.bufferCapacity } : {}) });
      } catch (error) { persistentRunner?.reset(); persistentRunner = null; deviceCache.reset(); return Object.freeze({ ...status, status: 'unavailable', reason: `webgpu-execution-failed:${error?.message || String(error)}`, targetCount: cpu.items[0].targetCount, pieceCount: cpu.items[0].pieceCount, origins: cpu.items[0].origins, validity: cpu.items[0].validity, acceptedIndices: cpu.items[0].acceptedIndices, candidateCount: cpu.candidateCount }); }
    },
    async generateBatch(inputs) {
      const normalized = normalizeBatchInput(inputs, normalizedGrid), cpu = cpuGenerateFrontierTargetBatch(inputs, normalizedGrid), status = await availability();
      if (status.status !== 'available') return Object.freeze({ ...status, candidateCount: normalized.candidateCount, items: cpu.items });
      try {
        const device = await deviceCache.getDevice();
        if (persistent && !persistentRunner) persistentRunner = createPersistentGpuTargetRunner(device, normalizedGrid, shaderSource);
        const resident = persistentRunner ? await persistentRunner.run(normalized) : null;
        const result = resident?.items || await runGpuBatch(device, normalized, normalizedGrid, shaderSource), parity = result.length === cpu.items.length && result.every((item, index) => JSON.stringify(item.origins) === JSON.stringify(cpu.items[index].origins) && JSON.stringify(item.validity) === JSON.stringify(cpu.items[index].validity));
        if (!parity) return Object.freeze({ schema: WEBGPU_FRONTIER_TARGET_GENERATOR_SCHEMA, status: 'rejected', backend: 'webgpu', reason: parityMismatchReason(result, cpu.items), candidateCount: normalized.candidateCount, items: cpu.items });
        return Object.freeze({ schema: WEBGPU_FRONTIER_TARGET_GENERATOR_SCHEMA, status: 'completed', backend: 'webgpu', parity: 'verified', batch: 'verified', candidateCount: normalized.candidateCount, items: result, ...(resident?.persistent ? { persistent: true, dispatch: resident.dispatch, dispatchCount: resident.dispatchCount, residentHandle: resident.residentHandle, bufferCapacity: resident.bufferCapacity } : {}) });
      } catch (error) { persistentRunner?.reset(); persistentRunner = null; deviceCache.reset(); return Object.freeze({ ...status, status: 'unavailable', reason: `webgpu-batch-execution-failed:${error?.message || String(error)}`, candidateCount: normalized.candidateCount, items: cpu.items }); }
    },
  });
}

export { SHADER as DEFAULT_SHADER };
