import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { DEFAULT_FRONTIER_GRID, createFrontierMaskFromCells } from './webgpu-frontier-validator.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_LABELED_FRONTIER_STATE_SCHEMA = 'tdotdh.webgpu-labeled-frontier-state.v0';
export const REMAINING_MASK_WORD_COUNT = 4;
export const MAX_PIECE_LABELS = 32;
export const DEFAULT_PERSISTENT_STATE_CANDIDATE_CAPACITY = 64;

const SHADER = `
struct Params { candidateCount: u32, wordCount: u32, pieceCount: u32, width: u32, height: u32, originX: i32, originY: i32, reserved: u32 };
@group(0) @binding(0) var<storage, read> parentLabels: array<u32>;
@group(0) @binding(1) var<storage, read> candidateMasks: array<u32>;
@group(0) @binding(2) var<storage, read> candidatePieceIndices: array<u32>;
@group(0) @binding(3) var<storage, read> remainingMasks: array<u32>;
@group(0) @binding(4) var<storage, read_write> nextLabels: array<u32>;
@group(0) @binding(5) var<storage, read_write> canonicalLabels: array<u32>;
@group(0) @binding(6) var<storage, read_write> absoluteHashes: array<u32>;
@group(0) @binding(7) var<storage, read_write> canonicalHashes: array<u32>;
@group(0) @binding(8) var<uniform> params: Params;

fn labelBit(base: u32, offset: u32) -> u32 { return (nextLabels[base + offset / 32u] >> (offset % 32u)) & 1u; }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.candidateCount) { return; }
  let labelStride = params.wordCount;
  let candidateBase = id.x * labelStride;
  let parentBase = id.x * params.pieceCount * labelStride;
  for (var piece: u32 = 0u; piece < params.pieceCount; piece++) for (var word: u32 = 0u; word < labelStride; word++) {
    let offset = id.x * params.pieceCount * labelStride + piece * labelStride + word;
    let nextOffset = piece * labelStride + word;
    nextLabels[candidateBase * params.pieceCount + nextOffset] = parentLabels[offset];
    canonicalLabels[candidateBase * params.pieceCount + nextOffset] = 0u;
  }
  let pieceIndex = candidatePieceIndices[id.x];
  let candidateMaskBase = id.x * labelStride;
  for (var word: u32 = 0u; word < labelStride; word++) {
    let nextOffset = candidateBase * params.pieceCount + pieceIndex * labelStride + word;
    nextLabels[nextOffset] = nextLabels[nextOffset] | candidateMasks[candidateMaskBase + word];
  }
  var found = false;
  var minX: i32 = 0;
  var minY: i32 = 0;
  for (var y: u32 = 0u; y < params.height; y++) for (var x: u32 = 0u; x < params.width; x++) {
    let offset = y * params.width + x;
    var occupied = false;
    for (var piece: u32 = 0u; piece < params.pieceCount; piece++) if (labelBit(candidateBase * params.pieceCount + piece * labelStride, offset) == 1u) { occupied = true; }
    if (occupied) { if (!found) { minX = i32(x); minY = i32(y); found = true; } else { minX = min(minX, i32(x)); minY = min(minY, i32(y)); } }
  }
  if (found) for (var piece: u32 = 0u; piece < params.pieceCount; piece++) for (var y: u32 = 0u; y < params.height; y++) for (var x: u32 = 0u; x < params.width; x++) {
    let offset = y * params.width + x;
    if (labelBit(candidateBase * params.pieceCount + piece * labelStride, offset) == 1u) {
      let canonicalX = x - u32(minX); let canonicalY = y - u32(minY); let canonicalOffset = canonicalY * params.width + canonicalX;
      let destination = candidateBase * params.pieceCount + piece * labelStride + canonicalOffset / 32u;
      canonicalLabels[destination] = canonicalLabels[destination] | (1u << (canonicalOffset % 32u));
    }
  }
  var absoluteHash: u32 = 2166136261u; var canonicalHash: u32 = 2166136261u;
  for (var piece: u32 = 0u; piece < params.pieceCount; piece++) for (var word: u32 = 0u; word < labelStride; word++) {
    let offset = candidateBase * params.pieceCount + piece * labelStride + word;
    absoluteHash = (absoluteHash ^ nextLabels[offset]) * 16777619u;
    canonicalHash = (canonicalHash ^ canonicalLabels[offset]) * 16777619u;
  }
  let remainingBase = id.x * ${REMAINING_MASK_WORD_COUNT}u;
  for (var word: u32 = 0u; word < ${REMAINING_MASK_WORD_COUNT}u; word++) { absoluteHash = (absoluteHash ^ remainingMasks[remainingBase + word]) * 16777619u; canonicalHash = (canonicalHash ^ remainingMasks[remainingBase + word]) * 16777619u; }
  absoluteHashes[id.x] = absoluteHash; canonicalHashes[id.x] = canonicalHash;
}`;

function normalizeGrid(grid = DEFAULT_FRONTIER_GRID) {
  const value = { ...DEFAULT_FRONTIER_GRID, ...grid };
  for (const key of ['width', 'height']) if (!Number.isSafeInteger(value[key]) || value[key] <= 0 || value[key] > 128) throw new TypeError(`grid.${key} must be a positive safe integer at most 128`);
  for (const key of ['originX', 'originY']) if (!Number.isSafeInteger(value[key])) throw new TypeError(`grid.${key} must be a safe integer`);
  return Object.freeze({ width: value.width, height: value.height, originX: value.originX, originY: value.originY, wordCount: Math.ceil(value.width * value.height / 32) });
}

function normalizePieceIds(pieceIds) {
  if (!Array.isArray(pieceIds) || pieceIds.length === 0 || pieceIds.length > MAX_PIECE_LABELS) throw new TypeError(`pieceIds must contain 1-${MAX_PIECE_LABELS} entries`);
  const ids = pieceIds.map((id, index) => { if (!Number.isSafeInteger(id) || id < 0) throw new TypeError(`pieceIds[${index}] must be a non-negative safe integer`); return id; });
  if (new Set(ids).size !== ids.length) throw new TypeError('pieceIds must be unique');
  return Object.freeze(ids);
}

function normalizeMask(mask, wordCount, label) {
  if (!Array.isArray(mask) && !(mask instanceof Uint32Array)) throw new TypeError(`${label} must be a uint32 word array`);
  if (mask.length !== wordCount) throw new RangeError(`${label} must contain exactly ${wordCount} words`);
  return Uint32Array.from(mask, word => { if (!Number.isSafeInteger(word) || word < 0 || word > 0xffffffff) throw new TypeError(`${label} contains a non-uint32 word`); return word; });
}

function remainingMask(ids) {
  if (!Array.isArray(ids)) throw new TypeError('remainingIds must be an array');
  const mask = new Uint32Array(REMAINING_MASK_WORD_COUNT);
  for (const id of ids) { if (!Number.isSafeInteger(id) || id < 0 || id >= 128) throw new TypeError('remainingIds entries must be integers from 0 through 127'); mask[Math.floor(id / 32)] |= 1 << (id % 32); }
  return mask;
}

function setMask(target, offset, cells, grid) {
  for (const cell of cells) {
    const x = cell.x - grid.originX, y = cell.y - grid.originY;
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) throw new RangeError('placement cell lies outside the frontier grid');
    const bit = y * grid.width + x;
    target[offset + Math.floor(bit / 32)] |= 1 << (bit % 32);
  }
}

export function createLabeledFrontierStateCandidate({ parentPlacements, candidate, pieceIds, remainingIds, parentStateIndex = null } = {}, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid), ids = normalizePieceIds(pieceIds), placementList = Array.isArray(parentPlacements) ? parentPlacements : [];
  if (!candidate || !Number.isSafeInteger(candidate.id) || !Array.isArray(candidate.cells) || candidate.cells.length === 0) throw new TypeError('candidate must contain an integer id and non-empty cells');
  const pieceIndex = ids.indexOf(candidate.id);
  if (pieceIndex < 0) throw new RangeError('candidate.id must be present in pieceIds');
  const parentLabelMasks = new Uint32Array(ids.length * normalizedGrid.wordCount);
  for (const placement of placementList) { const index = ids.indexOf(placement?.id); if (index < 0 || !Array.isArray(placement.cells) || placement.cells.length === 0) throw new TypeError('parent placements must use pieceIds and contain cells'); setMask(parentLabelMasks, index * normalizedGrid.wordCount, placement.cells, normalizedGrid); }
  if (parentStateIndex != null && (!Number.isSafeInteger(parentStateIndex) || parentStateIndex < 0)) throw new TypeError('parentStateIndex must be a non-negative safe integer');
  return Object.freeze({ parentLabelMasks, candidateMask: createFrontierMaskFromCells(candidate.cells, normalizedGrid), candidatePieceIndex: pieceIndex, remainingMask: remainingMask(remainingIds), pieceIds: ids, ...(parentStateIndex == null ? {} : { parentStateIndex }) });
}

function normalizeCandidates(candidates, grid) {
  if (!Array.isArray(candidates) || candidates.length === 0) throw new TypeError('labeled frontier state candidates must be a non-empty array');
  let pieceIds = null;
  const normalized = candidates.map((candidate, index) => {
    const ids = normalizePieceIds(candidate?.pieceIds);
    if (!pieceIds) pieceIds = ids; else if (JSON.stringify(ids) !== JSON.stringify(pieceIds)) throw new TypeError('all candidates must use the same pieceIds');
    return Object.freeze({ parentLabelMasks: normalizeMask(candidate.parentLabelMasks, ids.length * grid.wordCount, `candidate ${index}.parentLabelMasks`), candidateMask: normalizeMask(candidate.candidateMask, grid.wordCount, `candidate ${index}.candidateMask`), candidatePieceIndex: candidate.candidatePieceIndex, remainingMask: normalizeMask(candidate.remainingMask, REMAINING_MASK_WORD_COUNT, `candidate ${index}.remainingMask`), pieceIds: ids });
  });
  normalized.forEach((candidate, index) => { if (!Number.isSafeInteger(candidate.candidatePieceIndex) || candidate.candidatePieceIndex < 0 || candidate.candidatePieceIndex >= candidate.pieceIds.length) throw new TypeError(`candidate ${index}.candidatePieceIndex is invalid`); });
  return { normalized, pieceIds: Object.freeze(pieceIds) };
}

function canonicalize(labels, pieceCount, grid) {
  let minX = Infinity, minY = Infinity;
  for (let piece = 0; piece < pieceCount; piece++) for (let wordIndex = 0; wordIndex < grid.wordCount; wordIndex++) {
    let word = labels[piece * grid.wordCount + wordIndex] >>> 0;
    while (word) {
      const bitOffset = 31 - Math.clz32(word), bit = wordIndex * 32 + bitOffset;
      if (bit < grid.width * grid.height) { const x = bit % grid.width, y = Math.floor(bit / grid.width); minX = Math.min(minX, x); minY = Math.min(minY, y); }
      word = (word & ~(1 << bitOffset)) >>> 0;
    }
  }
  const output = new Uint32Array(pieceCount * grid.wordCount);
  if (!Number.isFinite(minX)) return output;
  for (let piece = 0; piece < pieceCount; piece++) for (let wordIndex = 0; wordIndex < grid.wordCount; wordIndex++) {
    let word = labels[piece * grid.wordCount + wordIndex] >>> 0;
    while (word) {
      const bitOffset = 31 - Math.clz32(word), bit = wordIndex * 32 + bitOffset;
      if (bit < grid.width * grid.height) { const x = bit % grid.width, y = Math.floor(bit / grid.width), canonicalBit = (y - minY) * grid.width + (x - minX); output[piece * grid.wordCount + Math.floor(canonicalBit / 32)] |= 1 << (canonicalBit % 32); }
      word = (word & ~(1 << bitOffset)) >>> 0;
    }
  }
  return output;
}

function hashState(labels, remaining) { let hash = 2166136261; for (const word of labels) hash = Math.imul(hash ^ word, 16777619) >>> 0; for (const word of remaining) hash = Math.imul(hash ^ word, 16777619) >>> 0; return hash; }

export function cpuTransitionLabeledFrontierStates(candidates, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid), { normalized, pieceIds } = normalizeCandidates(candidates, normalizedGrid), nextLabels = [], canonicalLabels = [], absoluteHashes = [], canonicalHashes = [];
  for (const candidate of normalized) { const next = Uint32Array.from(candidate.parentLabelMasks); const base = candidate.candidatePieceIndex * normalizedGrid.wordCount; for (let word = 0; word < normalizedGrid.wordCount; word++) next[base + word] |= candidate.candidateMask[word]; const canonical = canonicalize(next, pieceIds.length, normalizedGrid); nextLabels.push(...next); canonicalLabels.push(...canonical); absoluteHashes.push(hashState(next, candidate.remainingMask)); canonicalHashes.push(hashState(canonical, candidate.remainingMask)); }
  return Object.freeze({ schema: WEBGPU_LABELED_FRONTIER_STATE_SCHEMA, status: 'completed', backend: 'cpu-oracle', pieceIds, nextLabels, canonicalLabels, absoluteHashes, canonicalHashes, candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, pieceCount: pieceIds.length, parity: 'oracle' });
}

export function canonicalSignatureFromLabeledFrontierState({ pieceIds, canonicalLabels, wordCount, grid = DEFAULT_FRONTIER_GRID } = {}) {
  if (!Array.isArray(pieceIds) || !Array.isArray(canonicalLabels) || !Number.isSafeInteger(wordCount) || wordCount <= 0) throw new TypeError('pieceIds, canonicalLabels, and wordCount are required');
  if (canonicalLabels.length !== pieceIds.length * wordCount) throw new RangeError('canonicalLabels length does not match pieceIds and wordCount');
  const normalizedGrid = { ...DEFAULT_FRONTIER_GRID, ...grid };
  return pieceIds.map((pieceId, pieceIndex) => {
    const cells = [];
    for (let wordIndex = 0; wordIndex < wordCount; wordIndex++) {
      let word = canonicalLabels[pieceIndex * wordCount + wordIndex] >>> 0;
      while (word) {
        const bitOffset = 31 - Math.clz32(word), bit = wordIndex * 32 + bitOffset;
        if (bit < normalizedGrid.width * normalizedGrid.height) cells.push(`${bit % normalizedGrid.width},${Math.floor(bit / normalizedGrid.width)}`);
        word = (word & ~(1 << bitOffset)) >>> 0;
      }
    }
    return `${pieceId}:${cells.sort().join(';')}`;
  }).join('|');
}

function unavailable(reason, grid, cpu, extra = {}) { return Object.freeze({ schema: WEBGPU_LABELED_FRONTIER_STATE_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason), grid, pieceIds: cpu.pieceIds, nextLabels: cpu.nextLabels, canonicalLabels: cpu.canonicalLabels, absoluteHashes: cpu.absoluteHashes, canonicalHashes: cpu.canonicalHashes, candidateCount: cpu.candidateCount, wordCount: cpu.wordCount, pieceCount: cpu.pieceCount, ...extra }); }

function flatten(candidates, property, width) { const flat = new Uint32Array(candidates.length * width); candidates.forEach((candidate, index) => flat.set(candidate[property], index * width)); return flat; }

async function runGpuBatch(device, normalized, pieceIds, grid, shaderSource) {
  const count = normalized.length, labelsPerCandidate = pieceIds.length * grid.wordCount, labelBytes = Math.max(4, count * labelsPerCandidate * 4), maskBytes = Math.max(4, count * grid.wordCount * 4), remainingBytes = Math.max(4, count * REMAINING_MASK_WORD_COUNT * 4), hashBytes = Math.max(4, count * 4);
  const buffers = {
    parent: device.createBuffer({ size: labelBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }), candidate: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }), pieceIndices: device.createBuffer({ size: maskBytes / grid.wordCount, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }), remaining: device.createBuffer({ size: remainingBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }), next: device.createBuffer({ size: labelBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }), canonical: device.createBuffer({ size: labelBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }), absoluteHashes: device.createBuffer({ size: hashBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }), canonicalHashes: device.createBuffer({ size: hashBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }), params: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), nextReadback: device.createBuffer({ size: labelBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), canonicalReadback: device.createBuffer({ size: labelBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), absoluteHashReadback: device.createBuffer({ size: hashBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), canonicalHashReadback: device.createBuffer({ size: hashBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
  };
  try {
    device.queue.writeBuffer(buffers.parent, 0, flatten(normalized, 'parentLabelMasks', labelsPerCandidate)); device.queue.writeBuffer(buffers.candidate, 0, flatten(normalized, 'candidateMask', grid.wordCount)); device.queue.writeBuffer(buffers.pieceIndices, 0, Uint32Array.from(normalized.map(candidate => candidate.candidatePieceIndex))); device.queue.writeBuffer(buffers.remaining, 0, flatten(normalized, 'remainingMask', REMAINING_MASK_WORD_COUNT)); device.queue.writeBuffer(buffers.params, 0, new Int32Array([count, grid.wordCount, pieceIds.length, grid.width, grid.height, grid.originX, grid.originY, 0]));
    const module = device.createShaderModule({ code: shaderSource }), pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } }), bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((binding, index) => ({ binding, resource: { buffer: [buffers.parent, buffers.candidate, buffers.pieceIndices, buffers.remaining, buffers.next, buffers.canonical, buffers.absoluteHashes, buffers.canonicalHashes, buffers.params][index] } })) });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end(); encoder.copyBufferToBuffer(buffers.next, 0, buffers.nextReadback, 0, labelBytes); encoder.copyBufferToBuffer(buffers.canonical, 0, buffers.canonicalReadback, 0, labelBytes); encoder.copyBufferToBuffer(buffers.absoluteHashes, 0, buffers.absoluteHashReadback, 0, hashBytes); encoder.copyBufferToBuffer(buffers.canonicalHashes, 0, buffers.canonicalHashReadback, 0, hashBytes); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    await buffers.nextReadback.mapAsync(GPUMapMode.READ); const nextLabels = Array.from(new Uint32Array(buffers.nextReadback.getMappedRange().slice(0, labelBytes))); buffers.nextReadback.unmap(); await buffers.canonicalReadback.mapAsync(GPUMapMode.READ); const canonicalLabels = Array.from(new Uint32Array(buffers.canonicalReadback.getMappedRange().slice(0, labelBytes))); buffers.canonicalReadback.unmap(); await buffers.absoluteHashReadback.mapAsync(GPUMapMode.READ); const absoluteHashes = Array.from(new Uint32Array(buffers.absoluteHashReadback.getMappedRange().slice(0, hashBytes))); buffers.absoluteHashReadback.unmap(); await buffers.canonicalHashReadback.mapAsync(GPUMapMode.READ); const canonicalHashes = Array.from(new Uint32Array(buffers.canonicalHashReadback.getMappedRange().slice(0, hashBytes))); buffers.canonicalHashReadback.unmap();
    return { nextLabels, canonicalLabels, absoluteHashes, canonicalHashes };
  } finally { Object.values(buffers).forEach(buffer => buffer.destroy()); }
}

function createPersistentResources(device, capacity, pieceCount, grid, shaderSource) {
  const labelsBytes = capacity * pieceCount * grid.wordCount * 4;
  const maskBytes = capacity * grid.wordCount * 4;
  const pieceIndexBytes = capacity * 4;
  const remainingBytes = capacity * REMAINING_MASK_WORD_COUNT * 4;
  const hashBytes = capacity * 4;
  const buffers = {
    parent: device.createBuffer({ size: labelsBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    candidate: device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    pieceIndices: device.createBuffer({ size: pieceIndexBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    remaining: device.createBuffer({ size: remainingBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    next: device.createBuffer({ size: labelsBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    canonical: device.createBuffer({ size: labelsBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    absoluteHashes: device.createBuffer({ size: hashBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    canonicalHashes: device.createBuffer({ size: hashBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    params: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    nextReadback: device.createBuffer({ size: labelsBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    canonicalReadback: device.createBuffer({ size: labelsBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    absoluteHashReadback: device.createBuffer({ size: hashBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    canonicalHashReadback: device.createBuffer({ size: hashBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
  };
  const module = device.createShaderModule({ code: shaderSource });
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const bindings = [buffers.parent, buffers.candidate, buffers.pieceIndices, buffers.remaining, buffers.next, buffers.canonical, buffers.absoluteHashes, buffers.canonicalHashes, buffers.params];
  const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: bindings.map((buffer, binding) => ({ binding, resource: { buffer } })) });
  return { capacity, pieceCount, grid, buffers, pipeline, bindGroup };
}

function destroyPersistentResources(resources) {
  if (!resources) return;
  Object.values(resources.buffers).forEach(buffer => buffer.destroy());
}

async function runGpuPersistentBatch(device, resources, normalized, pieceIds, grid) {
  const { buffers, pipeline, bindGroup } = resources;
  const count = normalized.length, labelsPerCandidate = pieceIds.length * grid.wordCount, labelBytes = count * labelsPerCandidate * 4, maskBytes = count * grid.wordCount * 4, hashBytes = count * 4;
  device.queue.writeBuffer(buffers.parent, 0, flatten(normalized, 'parentLabelMasks', labelsPerCandidate));
  device.queue.writeBuffer(buffers.candidate, 0, flatten(normalized, 'candidateMask', grid.wordCount));
  device.queue.writeBuffer(buffers.pieceIndices, 0, Uint32Array.from(normalized.map(candidate => candidate.candidatePieceIndex)));
  device.queue.writeBuffer(buffers.remaining, 0, flatten(normalized, 'remainingMask', REMAINING_MASK_WORD_COUNT));
  device.queue.writeBuffer(buffers.params, 0, new Int32Array([count, grid.wordCount, pieceIds.length, grid.width, grid.height, grid.originX, grid.originY, 0]));
  const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end();
  encoder.copyBufferToBuffer(buffers.next, 0, buffers.nextReadback, 0, labelBytes);
  encoder.copyBufferToBuffer(buffers.canonical, 0, buffers.canonicalReadback, 0, labelBytes);
  encoder.copyBufferToBuffer(buffers.absoluteHashes, 0, buffers.absoluteHashReadback, 0, hashBytes);
  encoder.copyBufferToBuffer(buffers.canonicalHashes, 0, buffers.canonicalHashReadback, 0, hashBytes);
  device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
  await buffers.nextReadback.mapAsync(GPUMapMode.READ); const nextLabels = Array.from(new Uint32Array(buffers.nextReadback.getMappedRange().slice(0, labelBytes))); buffers.nextReadback.unmap();
  await buffers.canonicalReadback.mapAsync(GPUMapMode.READ); const canonicalLabels = Array.from(new Uint32Array(buffers.canonicalReadback.getMappedRange().slice(0, labelBytes))); buffers.canonicalReadback.unmap();
  await buffers.absoluteHashReadback.mapAsync(GPUMapMode.READ); const absoluteHashes = Array.from(new Uint32Array(buffers.absoluteHashReadback.getMappedRange().slice(0, hashBytes))); buffers.absoluteHashReadback.unmap();
  await buffers.canonicalHashReadback.mapAsync(GPUMapMode.READ); const canonicalHashes = Array.from(new Uint32Array(buffers.canonicalHashReadback.getMappedRange().slice(0, hashBytes))); buffers.canonicalHashReadback.unmap();
  return { nextLabels, canonicalLabels, absoluteHashes, canonicalHashes };
}

export function createWebGpuLabeledFrontierState({ gpu = globalThis.navigator?.gpu, grid = DEFAULT_FRONTIER_GRID, requiredLimits = { maxStorageBufferBindingSize: 1048576 }, shaderSource = SHADER, deviceCache = createWebGpuDeviceCache({ gpu }), capacity = DEFAULT_PERSISTENT_STATE_CANDIDATE_CAPACITY } = {}) {
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new TypeError('persistent frontier state capacity must be a positive safe integer');
  const normalizedGrid = normalizeGrid(grid), limits = { ...requiredLimits };
  let resources = null;
  const reset = () => { destroyPersistentResources(resources); resources = null; deviceCache.reset(); };
  return Object.freeze({
    reset,
    async availability() { const probe = await probeWebGpuCapabilities({ gpu, requiredLimits: limits }); if (!probe.adapterAvailable) return Object.freeze({ schema: WEBGPU_LABELED_FRONTIER_STATE_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: 'webgpu-adapter-unavailable', grid: normalizedGrid }); if (!probe.requiredLimitsSatisfied) return Object.freeze({ schema: WEBGPU_LABELED_FRONTIER_STATE_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: 'webgpu-required-limits-unsatisfied', grid: normalizedGrid }); return Object.freeze({ schema: WEBGPU_LABELED_FRONTIER_STATE_SCHEMA, status: 'available', backend: 'webgpu', grid: normalizedGrid }); },
    async transition(candidates) {
      const { normalized } = normalizeCandidates(candidates, normalizedGrid), cpu = cpuTransitionLabeledFrontierStates(candidates, normalizedGrid), status = await this.availability(); if (status.status !== 'available') return unavailable(status.reason, normalizedGrid, cpu, { persistent: true, bufferCapacity: capacity });
      try {
        const device = await deviceCache.getDevice(), maxBinding = Number(device.limits?.maxStorageBufferBindingSize) || limits.maxStorageBufferBindingSize, labelsPerCandidate = cpu.pieceCount * normalizedGrid.wordCount, maxBatch = Math.max(1, Math.floor(maxBinding / Math.max(labelsPerCandidate * 4, 4))), persistentBatch = Math.min(capacity, maxBatch), nextLabels = [], canonicalLabels = [], absoluteHashes = [], canonicalHashes = [];
        if (!resources) resources = createPersistentResources(device, persistentBatch, cpu.pieceCount, normalizedGrid, shaderSource);
        for (let offset = 0; offset < normalized.length; offset += persistentBatch) { const result = await runGpuPersistentBatch(device, resources, normalized.slice(offset, offset + persistentBatch), cpu.pieceIds, normalizedGrid); nextLabels.push(...result.nextLabels); canonicalLabels.push(...result.canonicalLabels); absoluteHashes.push(...result.absoluteHashes); canonicalHashes.push(...result.canonicalHashes); }
        if (JSON.stringify(nextLabels) !== JSON.stringify(cpu.nextLabels) || JSON.stringify(canonicalLabels) !== JSON.stringify(cpu.canonicalLabels) || JSON.stringify(absoluteHashes) !== JSON.stringify(cpu.absoluteHashes) || JSON.stringify(canonicalHashes) !== JSON.stringify(cpu.canonicalHashes)) return unavailable('oracle-parity-mismatch', normalizedGrid, cpu, { persistent: true, bufferCapacity: persistentBatch });
        return Object.freeze({ schema: WEBGPU_LABELED_FRONTIER_STATE_SCHEMA, status: 'completed', backend: 'webgpu', pieceIds: cpu.pieceIds, nextLabels, canonicalLabels, absoluteHashes, canonicalHashes, candidateCount: normalized.length, wordCount: cpu.wordCount, pieceCount: cpu.pieceCount, parity: 'verified', persistent: true, bufferCapacity: persistentBatch });
      } catch (error) { reset(); return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, normalizedGrid, cpu, { persistent: true, bufferCapacity: capacity }); }
    },
  });
}

export { SHADER as DEFAULT_SHADER };
