import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { DEFAULT_FRONTIER_GRID } from './webgpu-frontier-validator.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';
import { REMAINING_MASK_WORD_COUNT, WEBGPU_LABELED_FRONTIER_STATE_SCHEMA, cpuTransitionLabeledFrontierStates } from './webgpu-labeled-frontier-state.js';

export const WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA = 'tdotdh.webgpu-resident-frontier-state.v0';
export const DEFAULT_RESIDENT_FRONTIER_CAPACITY = 4096;
export const DEFAULT_RESIDENT_FRONTIER_BATCH_CAPACITY = 64;

const RESIDENT_PARENT_SENTINEL = 0xffffffff;

const SHADER = `
struct Params { candidateCount: u32, wordCount: u32, pieceCount: u32, width: u32, height: u32, originX: i32, originY: i32, reserved: u32 };
@group(0) @binding(0) var<storage, read> seedParents: array<u32>;
@group(0) @binding(1) var<storage, read> candidateMasks: array<u32>;
@group(0) @binding(2) var<storage, read> candidatePieceIndices: array<u32>;
@group(0) @binding(3) var<storage, read> remainingMasks: array<u32>;
@group(0) @binding(4) var<storage, read_write> nextLabels: array<u32>;
@group(0) @binding(5) var<storage, read_write> canonicalLabels: array<u32>;
@group(0) @binding(6) var<storage, read_write> absoluteHashes: array<u32>;
@group(0) @binding(7) var<storage, read_write> canonicalHashes: array<u32>;
@group(0) @binding(8) var<uniform> params: Params;
@group(0) @binding(9) var<storage, read> residentParents: array<u32>;
@group(0) @binding(10) var<storage, read_write> residentNext: array<u32>;
@group(0) @binding(11) var<storage, read_write> residentCanonical: array<u32>;
@group(0) @binding(12) var<storage, read> parentStateIndices: array<u32>;
@group(0) @binding(13) var<storage, read> outputStateIndices: array<u32>;

fn labelBit(base: u32, offset: u32) -> u32 { return (nextLabels[base + offset / 32u] >> (offset % 32u)) & 1u; }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.candidateCount) { return; }
  let labelStride = params.wordCount;
  let labelsPerState = params.pieceCount * labelStride;
  let localBase = id.x * labelsPerState;
  let parentIndex = parentStateIndices[id.x];
  let outputIndex = outputStateIndices[id.x];
  let parentBase = id.x * labelsPerState;
  let residentParentBase = parentIndex * labelsPerState;
  let residentOutputBase = outputIndex * labelsPerState;
  for (var piece: u32 = 0u; piece < params.pieceCount; piece++) for (var word: u32 = 0u; word < labelStride; word++) {
    let localOffset = localBase + piece * labelStride + word;
    if (parentIndex == ${RESIDENT_PARENT_SENTINEL}u) { nextLabels[localOffset] = seedParents[parentBase + piece * labelStride + word]; }
    else { nextLabels[localOffset] = residentParents[residentParentBase + piece * labelStride + word]; }
    canonicalLabels[localOffset] = 0u;
  }
  let pieceIndex = candidatePieceIndices[id.x];
  let candidateMaskBase = id.x * labelStride;
  for (var word: u32 = 0u; word < labelStride; word++) {
    let nextOffset = localBase + pieceIndex * labelStride + word;
    nextLabels[nextOffset] = nextLabels[nextOffset] | candidateMasks[candidateMaskBase + word];
  }
  var found = false;
  var minX: i32 = 0;
  var minY: i32 = 0;
  for (var y: u32 = 0u; y < params.height; y++) for (var x: u32 = 0u; x < params.width; x++) {
    let offset = y * params.width + x;
    var occupied = false;
    for (var piece: u32 = 0u; piece < params.pieceCount; piece++) if (labelBit(localBase + piece * labelStride, offset) == 1u) { occupied = true; }
    if (occupied) { if (!found) { minX = i32(x); minY = i32(y); found = true; } else { minX = min(minX, i32(x)); minY = min(minY, i32(y)); } }
  }
  if (found) for (var piece: u32 = 0u; piece < params.pieceCount; piece++) for (var y: u32 = 0u; y < params.height; y++) for (var x: u32 = 0u; x < params.width; x++) {
    let offset = y * params.width + x;
    if (labelBit(localBase + piece * labelStride, offset) == 1u) {
      let canonicalX = i32(x) - minX; let canonicalY = i32(y) - minY;
      let canonicalOffset = u32(canonicalY * i32(params.width) + canonicalX);
      let destination = localBase + piece * labelStride + canonicalOffset / 32u;
      canonicalLabels[destination] = canonicalLabels[destination] | (1u << (canonicalOffset % 32u));
    }
  }
  var absoluteHash: u32 = 2166136261u; var canonicalHash: u32 = 2166136261u;
  for (var piece: u32 = 0u; piece < params.pieceCount; piece++) for (var word: u32 = 0u; word < labelStride; word++) {
    let offset = localBase + piece * labelStride + word;
    absoluteHash = (absoluteHash ^ nextLabels[offset]) * 16777619u;
    canonicalHash = (canonicalHash ^ canonicalLabels[offset]) * 16777619u;
    residentNext[residentOutputBase + piece * labelStride + word] = nextLabels[offset];
    residentCanonical[residentOutputBase + piece * labelStride + word] = canonicalLabels[offset];
  }
  let remainingBase = id.x * ${REMAINING_MASK_WORD_COUNT}u;
  for (var word: u32 = 0u; word < ${REMAINING_MASK_WORD_COUNT}u; word++) { absoluteHash = (absoluteHash ^ remainingMasks[remainingBase + word]) * 16777619u; canonicalHash = (canonicalHash ^ remainingMasks[remainingBase + word]) * 16777619u; }
  absoluteHashes[id.x] = absoluteHash; canonicalHashes[id.x] = canonicalHash;
}`;

function normalizeGrid(grid = DEFAULT_FRONTIER_GRID) {
  const value = { ...DEFAULT_FRONTIER_GRID, ...grid };
  if (!Number.isSafeInteger(value.width) || value.width <= 0 || value.width > 128 || !Number.isSafeInteger(value.height) || value.height <= 0 || value.height > 128) throw new TypeError('resident frontier grid dimensions are invalid');
  if (!Number.isSafeInteger(value.originX) || !Number.isSafeInteger(value.originY)) throw new TypeError('resident frontier grid origin is invalid');
  return Object.freeze({ width: value.width, height: value.height, originX: value.originX, originY: value.originY, wordCount: Math.ceil(value.width * value.height / 32) });
}

function normalizeCandidates(candidates, grid) {
  if (!Array.isArray(candidates) || !candidates.length) throw new TypeError('resident frontier candidates must be a non-empty array');
  const pieceIds = candidates[0]?.pieceIds;
  if (!Array.isArray(pieceIds) || !pieceIds.length) throw new TypeError('resident frontier candidates require pieceIds');
  const labelsPerState = pieceIds.length * grid.wordCount;
  return candidates.map((candidate, index) => {
    if (!Array.isArray(candidate.parentLabelMasks) && !(candidate.parentLabelMasks instanceof Uint32Array) || candidate.parentLabelMasks.length !== labelsPerState) throw new TypeError(`candidate ${index}.parentLabelMasks has invalid length`);
    if (!Array.isArray(candidate.candidateMask) && !(candidate.candidateMask instanceof Uint32Array)) throw new TypeError(`candidate ${index}.candidateMask is required`);
    if (candidate.candidateMask.length !== grid.wordCount) throw new TypeError(`candidate ${index}.candidateMask has invalid length`);
    if (!Array.isArray(candidate.remainingMask) && !(candidate.remainingMask instanceof Uint32Array)) throw new TypeError(`candidate ${index}.remainingMask is required`);
    if (candidate.remainingMask.length !== REMAINING_MASK_WORD_COUNT) throw new TypeError(`candidate ${index}.remainingMask has invalid length`);
    const parentStateIndex = candidate.parentStateIndex == null ? null : Number(candidate.parentStateIndex);
    if (parentStateIndex != null && (!Number.isSafeInteger(parentStateIndex) || parentStateIndex < 0)) throw new TypeError(`candidate ${index}.parentStateIndex is invalid`);
    if (JSON.stringify(candidate.pieceIds) !== JSON.stringify(pieceIds)) throw new TypeError('resident frontier candidates must share pieceIds');
    return Object.freeze({ parentLabelMasks: Uint32Array.from(candidate.parentLabelMasks), candidateMask: Uint32Array.from(candidate.candidateMask), candidatePieceIndex: Number(candidate.candidatePieceIndex), remainingMask: Uint32Array.from(candidate.remainingMask), parentStateIndex, pieceIds });
  });
}

function flatten(candidates, property, width) { const flat = new Uint32Array(candidates.length * width); candidates.forEach((candidate, index) => flat.set(candidate[property], index * width)); return flat; }
function equalArrays(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function parityMismatchReason(actual, expected) {
  for (const [name, values] of Object.entries(actual)) {
    const target = expected[name];
    if (!Array.isArray(values) || !Array.isArray(target) || values.length !== target.length) return `oracle-parity-mismatch:${name}:length:${values?.length ?? 'missing'}!=${target?.length ?? 'missing'}`;
    const index = values.findIndex((value, offset) => value !== target[offset]);
    if (index >= 0) return `oracle-parity-mismatch:${name}:${index}:${values[index]}!=${target[index]}`;
  }
  return 'oracle-parity-mismatch';
}
function unavailable(reason, cpu, extra = {}) { return Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason), pieceIds: cpu.pieceIds, nextLabels: cpu.nextLabels, canonicalLabels: cpu.canonicalLabels, absoluteHashes: cpu.absoluteHashes, canonicalHashes: cpu.canonicalHashes, candidateCount: cpu.candidateCount, wordCount: cpu.wordCount, pieceCount: cpu.pieceCount, parity: 'oracle', ...extra }); }

function makeResources(device, capacity, batchCapacity, pieceCount, grid, shaderSource) {
  const labelsPerState = pieceCount * grid.wordCount;
  const residentBytes = capacity * labelsPerState * 4;
  const batchLabelsBytes = batchCapacity * labelsPerState * 4;
  const batchMaskBytes = batchCapacity * grid.wordCount * 4;
  const remainingBytes = batchCapacity * REMAINING_MASK_WORD_COUNT * 4;
  const hashBytes = batchCapacity * 4;
  const buffers = {
    seedParents: device.createBuffer({ size: batchLabelsBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    candidateMasks: device.createBuffer({ size: batchMaskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    candidatePieceIndices: device.createBuffer({ size: batchCapacity * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    remainingMasks: device.createBuffer({ size: remainingBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    nextLabels: device.createBuffer({ size: batchLabelsBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    canonicalLabels: device.createBuffer({ size: batchLabelsBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    absoluteHashes: device.createBuffer({ size: hashBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    canonicalHashes: device.createBuffer({ size: hashBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    params: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    residentParents: device.createBuffer({ size: residentBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    residentNext: device.createBuffer({ size: residentBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    residentCanonical: device.createBuffer({ size: residentBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    parentStateIndices: device.createBuffer({ size: batchCapacity * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    outputStateIndices: device.createBuffer({ size: batchCapacity * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    nextReadback: device.createBuffer({ size: batchLabelsBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    canonicalReadback: device.createBuffer({ size: batchLabelsBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    absoluteHashReadback: device.createBuffer({ size: hashBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    canonicalHashReadback: device.createBuffer({ size: hashBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
  };
  const module = device.createShaderModule({ code: shaderSource }), pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const bindingBuffers = [buffers.seedParents, buffers.candidateMasks, buffers.candidatePieceIndices, buffers.remainingMasks, buffers.nextLabels, buffers.canonicalLabels, buffers.absoluteHashes, buffers.canonicalHashes, buffers.params, buffers.residentParents, buffers.residentNext, buffers.residentCanonical, buffers.parentStateIndices, buffers.outputStateIndices];
  const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: bindingBuffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
  return { capacity, batchCapacity, pieceCount, grid, labelsPerState, buffers, pipeline, bindGroup };
}

function destroyResources(resources) { if (resources) Object.values(resources.buffers).forEach(buffer => buffer.destroy()); }

async function readback(buffer, bytes) { await buffer.mapAsync(GPUMapMode.READ); const values = Array.from(new Uint32Array(buffer.getMappedRange().slice(0, bytes))); buffer.unmap(); return values; }

async function dispatch(device, resources, candidates, pieceIds, outputIndices, grid) {
  const { buffers, pipeline, bindGroup, labelsPerState } = resources, count = candidates.length, labelBytes = count * labelsPerState * 4, maskBytes = count * grid.wordCount * 4, hashBytes = count * 4;
  device.queue.writeBuffer(buffers.seedParents, 0, flatten(candidates, 'parentLabelMasks', labelsPerState));
  device.queue.writeBuffer(buffers.candidateMasks, 0, flatten(candidates, 'candidateMask', grid.wordCount));
  device.queue.writeBuffer(buffers.candidatePieceIndices, 0, Uint32Array.from(candidates.map(candidate => candidate.candidatePieceIndex)));
  device.queue.writeBuffer(buffers.remainingMasks, 0, flatten(candidates, 'remainingMask', REMAINING_MASK_WORD_COUNT));
  device.queue.writeBuffer(buffers.parentStateIndices, 0, Uint32Array.from(candidates.map(candidate => candidate.parentStateIndex == null ? RESIDENT_PARENT_SENTINEL : candidate.parentStateIndex)));
  device.queue.writeBuffer(buffers.outputStateIndices, 0, Uint32Array.from(outputIndices));
  device.queue.writeBuffer(buffers.params, 0, new Int32Array([count, grid.wordCount, pieceIds.length, grid.width, grid.height, grid.originX, grid.originY, 0]));
  const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end();
  encoder.copyBufferToBuffer(buffers.nextLabels, 0, buffers.nextReadback, 0, labelBytes); encoder.copyBufferToBuffer(buffers.canonicalLabels, 0, buffers.canonicalReadback, 0, labelBytes); encoder.copyBufferToBuffer(buffers.absoluteHashes, 0, buffers.absoluteHashReadback, 0, hashBytes); encoder.copyBufferToBuffer(buffers.canonicalHashes, 0, buffers.canonicalHashReadback, 0, hashBytes);
  device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
  return { nextLabels: await readback(buffers.nextReadback, labelBytes), canonicalLabels: await readback(buffers.canonicalReadback, labelBytes), absoluteHashes: await readback(buffers.absoluteHashReadback, hashBytes), canonicalHashes: await readback(buffers.canonicalHashReadback, hashBytes) };
}

/**
 * A two-generation GPU frontier pool. `beginLayer` freezes the input pool,
 * `transition` writes all children into the other pool, and `commitLayer`
 * swaps them. Parent references therefore remain GPU-local across a full beam
 * layer; only canonical replay arrays and hashes are read back for admission.
 */
export function createWebGpuResidentFrontierState({ gpu = globalThis.navigator?.gpu, grid = DEFAULT_FRONTIER_GRID, deviceCache = createWebGpuDeviceCache({ gpu }), capacity = DEFAULT_RESIDENT_FRONTIER_CAPACITY, batchCapacity = DEFAULT_RESIDENT_FRONTIER_BATCH_CAPACITY, requiredLimits = { maxStorageBufferBindingSize: 33554432 }, shaderSource = SHADER } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new TypeError('resident frontier capacity must be a positive safe integer');
  if (!Number.isSafeInteger(batchCapacity) || batchCapacity <= 0 || batchCapacity > capacity) throw new TypeError('resident frontier batch capacity is invalid');
  const normalizedGrid = normalizeGrid(grid), limits = { ...requiredLimits };
  let resources = null, pieceIds = null, epoch = 0, residentCount = 0, layer = null;
  const reset = () => { destroyResources(resources); resources = null; pieceIds = null; epoch = 0; residentCount = 0; layer = null; deviceCache.reset(); };
  const availability = async () => { const probe = await probeWebGpuCapabilities({ gpu, requiredLimits: limits }); return probe.adapterAvailable && probe.requiredLimitsSatisfied ? Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'available', backend: 'webgpu', capacity, batchCapacity, grid: normalizedGrid }) : Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable', capacity, batchCapacity, grid: normalizedGrid }); };
  const beginLayer = () => { if (layer) throw new Error('resident frontier layer is already active'); layer = { nextSlot: 0, pieceIds: null, pendingEpoch: epoch + 1 }; return Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'layer-open', epoch, nextEpoch: layer.pendingEpoch }); };
  const commitLayer = () => { if (!layer) return Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'idle', epoch }); const committed = Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'layer-committed', epoch: layer.pendingEpoch, outputCount: layer.nextSlot }); epoch = layer.pendingEpoch; residentCount = layer.nextSlot; layer = null; if (resources) { const old = resources.buffers.residentParents; resources.buffers.residentParents = resources.buffers.residentNext; resources.buffers.residentNext = old; const bindingBuffers = [resources.buffers.seedParents, resources.buffers.candidateMasks, resources.buffers.candidatePieceIndices, resources.buffers.remainingMasks, resources.buffers.nextLabels, resources.buffers.canonicalLabels, resources.buffers.absoluteHashes, resources.buffers.canonicalHashes, resources.buffers.params, resources.buffers.residentParents, resources.buffers.residentNext, resources.buffers.residentCanonical, resources.buffers.parentStateIndices, resources.buffers.outputStateIndices]; resources.bindGroup = resources.device.createBindGroup({ layout: resources.pipeline.getBindGroupLayout(0), entries: bindingBuffers.map((buffer, binding) => ({ binding, resource: { buffer } })) }); } return committed; };
  return Object.freeze({
    schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA,
    availability,
    beginLayer,
    commitLayer,
    reset,
    epoch: () => epoch,
    async transition(candidates) {
      const normalized = normalizeCandidates(candidates, normalizedGrid), cpu = cpuTransitionLabeledFrontierStates(candidates, normalizedGrid);
      if (!layer) beginLayer();
      if (!pieceIds) pieceIds = normalized[0].pieceIds;
      if (JSON.stringify(pieceIds) !== JSON.stringify(normalized[0].pieceIds)) return unavailable('piece-id-set-changed', cpu);
      if (layer.pieceIds && JSON.stringify(layer.pieceIds) !== JSON.stringify(normalized[0].pieceIds)) return unavailable('layer-piece-id-set-changed', cpu);
      layer.pieceIds = normalized[0].pieceIds;
      if (layer.nextSlot + normalized.length > capacity) return unavailable('resident-frontier-capacity-exceeded', cpu, { capacity, epoch: layer.pendingEpoch });
      const status = await availability(); if (status.status !== 'available') return unavailable(status.reason, cpu, { capacity, epoch: layer.pendingEpoch });
      try {
        const device = await deviceCache.getDevice();
        if (!resources) { resources = makeResources(device, capacity, batchCapacity, cpu.pieceCount, normalizedGrid, shaderSource); resources.device = device; }
        if (resources.pieceCount !== cpu.pieceCount || resources.grid.wordCount !== cpu.wordCount) { reset(); return unavailable('resident-frontier-shape-changed', cpu); }
        for (const candidate of normalized) if (candidate.parentStateIndex != null && candidate.parentStateIndex >= residentCount) return unavailable('resident-parent-reference-not-in-input-layer', cpu, { capacity, epoch: layer.pendingEpoch, residentCount });
        const nextLabels = [], canonicalLabels = [], absoluteHashes = [], canonicalHashes = [], residentStateIndices = [];
        for (let offset = 0; offset < normalized.length; offset += batchCapacity) { const batch = normalized.slice(offset, offset + batchCapacity), outputIndices = batch.map((_, index) => layer.nextSlot + offset + index); const result = await dispatch(device, resources, batch, cpu.pieceIds, outputIndices, normalizedGrid); nextLabels.push(...result.nextLabels); canonicalLabels.push(...result.canonicalLabels); absoluteHashes.push(...result.absoluteHashes); canonicalHashes.push(...result.canonicalHashes); residentStateIndices.push(...outputIndices); }
        const actual = { nextLabels, canonicalLabels, absoluteHashes, canonicalHashes }, expected = { nextLabels: cpu.nextLabels, canonicalLabels: cpu.canonicalLabels, absoluteHashes: cpu.absoluteHashes, canonicalHashes: cpu.canonicalHashes };
        if (!equalArrays(nextLabels, cpu.nextLabels) || !equalArrays(canonicalLabels, cpu.canonicalLabels) || !equalArrays(absoluteHashes, cpu.absoluteHashes) || !equalArrays(canonicalHashes, cpu.canonicalHashes)) return unavailable(parityMismatchReason(actual, expected), cpu, { capacity, epoch: layer.pendingEpoch });
        layer.nextSlot += normalized.length;
        return Object.freeze({ schema: WEBGPU_LABELED_FRONTIER_STATE_SCHEMA, status: 'completed', backend: 'webgpu', pieceIds: cpu.pieceIds, nextLabels, canonicalLabels, absoluteHashes, canonicalHashes, candidateCount: normalized.length, wordCount: cpu.wordCount, pieceCount: cpu.pieceCount, parity: 'verified', persistent: true, resident: true, residentEpoch: layer.pendingEpoch, residentStateIndices, bufferCapacity: capacity, batchCapacity });
      } catch (error) { reset(); return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, cpu); }
    },
  });
}

export { SHADER as DEFAULT_RESIDENT_SHADER };
