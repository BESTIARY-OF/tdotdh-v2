import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { DEFAULT_FRONTIER_GRID } from './webgpu-frontier-validator.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js?v=20260810-limits1';
import { REMAINING_MASK_WORD_COUNT, WEBGPU_LABELED_FRONTIER_STATE_SCHEMA, cpuTransitionLabeledFrontierStates } from './webgpu-labeled-frontier-state.js';

export const WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA = 'tdotdh.webgpu-resident-frontier-state.v0';
export const WEBGPU_RESIDENT_PARENT_REFERENCE_SCHEMA = 'tdotdh.webgpu-resident-parent-reference.v0';
export const DEFAULT_RESIDENT_FRONTIER_CAPACITY = 4096;
// Keep intermediate frontier transitions GPU-resident in large enough chunks
// to avoid a queue wait and mapped readback for every small beam slice. The
// resident pool remains bounded at 4096 states; 512 is below the 32 MiB
// storage-binding limit for the specialized 64x64 state layout.
export const DEFAULT_RESIDENT_FRONTIER_BATCH_CAPACITY = 1024;

const RESIDENT_PARENT_SENTINEL = 0xffffffff;

const SHADER = `
struct Params { candidateCount: u32, wordCount: u32, pieceCount: u32, width: u32, height: u32, originX: i32, originY: i32, reserved: u32 };
@group(0) @binding(0) var<storage, read> seedParents: array<u32>;
@group(0) @binding(1) var<storage, read> candidateMasks: array<u32>;
@group(0) @binding(2) var<storage, read> candidatePieceIndices: array<u32>;
@group(0) @binding(3) var<storage, read> remainingMasks: array<u32>;
@group(0) @binding(4) var<storage, read_write> nextLabels: array<u32>;
@group(0) @binding(5) var<storage, read_write> canonicalLabels: array<u32>;
@group(0) @binding(6) var<storage, read_write> digests: array<u32>;
@group(0) @binding(7) var<storage, read> params: Params;
@group(0) @binding(8) var<storage, read> residentParents: array<u32>;
@group(0) @binding(9) var<storage, read_write> residentNext: array<u32>;
@group(0) @binding(10) var<storage, read_write> residentCanonical: array<u32>;
@group(0) @binding(11) var<storage, read> parentStateIndices: array<u32>;
@group(0) @binding(12) var<storage, read> outputStateIndices: array<u32>;

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
  let pieceIndex = candidatePieceIndices[id.x];
  let candidateMaskBase = id.x * params.wordCount;
  for (var piece: u32 = 0u; piece < params.pieceCount; piece++) {
    for (var word: u32 = 0u; word < labelStride; word++) {
      let localOffset = localBase + piece * labelStride + word;
      var parentValue = 0u;
      if (parentIndex == ${RESIDENT_PARENT_SENTINEL}u) { parentValue = seedParents[parentBase + piece * labelStride + word]; }
      else { parentValue = residentParents[residentParentBase + piece * labelStride + word]; }
      let candidateValue = select(0u, candidateMasks[candidateMaskBase + word], piece == pieceIndex);
      nextLabels[localOffset] = parentValue | candidateValue;
      canonicalLabels[localOffset] = 0u;
    }
  }
  var found = false;
  var minX: i32 = 0;
  var minY: i32 = 0;
  for (var y: u32 = 0u; y < params.height; y++) {
    for (var x: u32 = 0u; x < params.width; x++) {
      let offset = y * params.width + x;
      var occupied = false;
      for (var piece: u32 = 0u; piece < params.pieceCount; piece++) {
        if (labelBit(localBase + piece * labelStride, offset) == 1u) { occupied = true; }
      }
      if (occupied) { if (!found) { minX = i32(x); minY = i32(y); found = true; } else { minX = min(minX, i32(x)); minY = min(minY, i32(y)); } }
    }
  }
  if (found) {
    for (var piece: u32 = 0u; piece < params.pieceCount; piece++) {
      for (var y: u32 = 0u; y < params.height; y++) {
        for (var x: u32 = 0u; x < params.width; x++) {
          let offset = y * params.width + x;
          if (labelBit(localBase + piece * labelStride, offset) == 1u) {
            let canonicalX = i32(x) - minX; let canonicalY = i32(y) - minY;
            let canonicalOffset = u32(canonicalY * i32(params.width) + canonicalX);
            let destination = localBase + piece * labelStride + canonicalOffset / 32u;
            canonicalLabels[destination] = canonicalLabels[destination] | (1u << (canonicalOffset % 32u));
          }
        }
      }
    }
  }
  var absoluteHash: u32 = 2166136261u; var canonicalHash: u32 = 2166136261u;
  for (var piece: u32 = 0u; piece < params.pieceCount; piece++) {
    for (var word: u32 = 0u; word < labelStride; word++) {
      let offset = localBase + piece * labelStride + word;
      absoluteHash = (absoluteHash ^ nextLabels[offset]) * 16777619u;
      canonicalHash = (canonicalHash ^ canonicalLabels[offset]) * 16777619u;
      residentNext[residentOutputBase + piece * labelStride + word] = nextLabels[offset];
      residentCanonical[residentOutputBase + piece * labelStride + word] = canonicalLabels[offset];
    }
  }
  let remainingBase = id.x * ${REMAINING_MASK_WORD_COUNT}u;
  for (var word: u32 = 0u; word < ${REMAINING_MASK_WORD_COUNT}u; word++) { absoluteHash = (absoluteHash ^ remainingMasks[remainingBase + word]) * 16777619u; canonicalHash = (canonicalHash ^ remainingMasks[remainingBase + word]) * 16777619u; }
  digests[id.x * 2u] = absoluteHash; digests[id.x * 2u + 1u] = canonicalHash;
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

function parentReferenceReceipt(candidates) {
  const parentStateIndices = candidates.map(candidate => candidate.parentStateIndex), referencedCount = parentStateIndices.filter(index => index != null).length, seedCount = candidates.length - referencedCount;
  return Object.freeze({
    schema: WEBGPU_RESIDENT_PARENT_REFERENCE_SCHEMA,
    mode: referencedCount === candidates.length ? 'resident-slots' : referencedCount === 0 ? 'seed-labels' : 'mixed',
    candidateCount: candidates.length,
    referencedCount,
    seedCount,
    parentStateIndices,
  });
}

function flatten(candidates, property, width) { const flat = new Uint32Array(candidates.length * width); candidates.forEach((candidate, index) => flat.set(candidate[property], index * width)); return flat; }
function equalArrays(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function parityMismatchReason(actual, expected, context = {}) {
  for (const [name, values] of Object.entries(actual)) {
    const target = expected[name];
    if (!Array.isArray(values) || !Array.isArray(target) || values.length !== target.length) return `oracle-parity-mismatch:${name}:length:${values?.length ?? 'missing'}!=${target?.length ?? 'missing'}`;
    const index = values.findIndex((value, offset) => value !== target[offset]);
    if (index >= 0) {
      const labelsPerState = Number(context.labelsPerState) || 0, candidateIndex = labelsPerState ? Math.floor(index / labelsPerState) : null, stateOffset = labelsPerState ? index % labelsPerState : index;
      const parentIndex = candidateIndex == null ? null : context.parentStateIndices?.[candidateIndex];
      const pieceCount = Number(context.pieceCount) || 0, wordCount = Number(context.wordCount) || 0, pieceIndex = wordCount ? Math.floor(stateOffset / wordCount) : null, wordIndex = wordCount ? stateOffset % wordCount : stateOffset;
      const seedValue = candidateIndex == null || !context.seedParents?.[candidateIndex] ? null : context.seedParents[candidateIndex][stateOffset];
      const candidateValue = candidateIndex == null || !context.candidateMasks?.[candidateIndex] || pieceIndex !== context.candidatePieceIndices?.[candidateIndex] ? null : context.candidateMasks[candidateIndex][wordIndex];
      return `oracle-parity-mismatch:${name}:${index}:candidate=${candidateIndex}:piece=${pieceIndex}:word=${wordIndex}:parent=${parentIndex ?? 'seed'}:seed=${seedValue ?? 'n/a'}:mask=${candidateValue ?? 'n/a'}:${values[index]}!=${target[index]}`;
    }
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
    digests: device.createBuffer({ size: hashBytes * 2, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    params: device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    residentParents: device.createBuffer({ size: residentBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    residentNext: device.createBuffer({ size: residentBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    residentCanonical: device.createBuffer({ size: residentBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    parentStateIndices: device.createBuffer({ size: batchCapacity * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    outputStateIndices: device.createBuffer({ size: batchCapacity * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    nextReadback: device.createBuffer({ size: batchLabelsBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    canonicalReadback: device.createBuffer({ size: batchLabelsBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    digestReadback: device.createBuffer({ size: hashBytes * 2, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
  };
  const specializedShader = shaderSource
    .replaceAll('params.wordCount', `${grid.wordCount}u`)
    .replaceAll('params.pieceCount', `${pieceCount}u`)
    .replaceAll('params.width', `${grid.width}u`)
    .replaceAll('params.height', `${grid.height}u`);
  const module = device.createShaderModule({ code: specializedShader }), pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const bindingBuffers = [buffers.seedParents, buffers.candidateMasks, buffers.candidatePieceIndices, buffers.remainingMasks, buffers.nextLabels, buffers.canonicalLabels, buffers.digests, buffers.params, buffers.residentParents, buffers.residentNext, buffers.residentCanonical, buffers.parentStateIndices, buffers.outputStateIndices];
  const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: bindingBuffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
  return { capacity, batchCapacity, pieceCount, grid, labelsPerState, buffers, pipeline, bindGroup };
}

function destroyResources(resources) { if (resources) Object.values(resources.buffers).forEach(buffer => buffer.destroy()); }

async function readback(buffer, bytes) { await buffer.mapAsync(GPUMapMode.READ); const values = Array.from(new Uint32Array(buffer.getMappedRange().slice(0, bytes))); buffer.unmap(); return values; }

async function dispatch(device, resources, candidates, pieceIds, outputIndices, grid, { readLabels = true } = {}) {
  const { buffers, pipeline, bindGroup, labelsPerState } = resources, count = candidates.length, labelBytes = count * labelsPerState * 4, maskBytes = count * grid.wordCount * 4, hashBytes = count * 4, digestBytes = hashBytes * 2;
  // Resident children read their parent labels from residentParents. Roots
  // read the explicit seed buffer; do not write and read residentParents in
  // the same dispatch. Avoiding the full seed transfer is the fast path once
  // a beam layer is resident on the GPU.
  device.queue.writeBuffer(buffers.candidateMasks, 0, flatten(candidates, 'candidateMask', grid.wordCount));
  device.queue.writeBuffer(buffers.candidatePieceIndices, 0, Uint32Array.from(candidates.map(candidate => candidate.candidatePieceIndex)));
  device.queue.writeBuffer(buffers.remainingMasks, 0, flatten(candidates, 'remainingMask', REMAINING_MASK_WORD_COUNT));
  const parentStateIndices = candidates.map((candidate, index) => {
    if (candidate.parentStateIndex != null) return candidate.parentStateIndex;
    device.queue.writeBuffer(buffers.seedParents, index * labelsPerState * 4, candidate.parentLabelMasks);
    return RESIDENT_PARENT_SENTINEL;
  });
  device.queue.writeBuffer(buffers.parentStateIndices, 0, Uint32Array.from(parentStateIndices));
  device.queue.writeBuffer(buffers.outputStateIndices, 0, Uint32Array.from(outputIndices));
  device.queue.writeBuffer(buffers.params, 0, new Int32Array([count, grid.wordCount, pieceIds.length, grid.width, grid.height, grid.originX, grid.originY, 0]));
  const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end();
  if (readLabels) {
    encoder.copyBufferToBuffer(buffers.nextLabels, 0, buffers.nextReadback, 0, labelBytes);
    encoder.copyBufferToBuffer(buffers.canonicalLabels, 0, buffers.canonicalReadback, 0, labelBytes);
  }
  encoder.copyBufferToBuffer(buffers.digests, 0, buffers.digestReadback, 0, digestBytes);
  device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
  const nextLabels = readLabels ? await readback(buffers.nextReadback, labelBytes) : [], canonicalLabels = readLabels ? await readback(buffers.canonicalReadback, labelBytes) : [], digestValues = await readback(buffers.digestReadback, digestBytes), absoluteHashes = [], canonicalHashes = [];
  for (let index = 0; index < count; index++) { absoluteHashes.push(digestValues[index * 2]); canonicalHashes.push(digestValues[index * 2 + 1]); }
  return { nextLabels, canonicalLabels, absoluteHashes, canonicalHashes, readback: readLabels ? 'full-labels-and-digests' : 'state-digests-only' };
}

/**
 * A two-generation GPU frontier pool. `beginLayer` freezes the input pool,
 * `transition` writes all children into the other pool, and `commitLayer`
 * swaps them. Parent references therefore remain GPU-local across a full beam
 * layer; only canonical replay arrays and hashes are read back for admission.
 */
export function createWebGpuResidentFrontierState({ gpu = globalThis.navigator?.gpu, grid = DEFAULT_FRONTIER_GRID, deviceCache = null, capacity = DEFAULT_RESIDENT_FRONTIER_CAPACITY, batchCapacity = DEFAULT_RESIDENT_FRONTIER_BATCH_CAPACITY, requiredLimits = { maxStorageBufferBindingSize: 33554432, maxStorageBuffersPerShaderStage: 14 }, shaderSource = SHADER } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new TypeError('resident frontier capacity must be a positive safe integer');
  if (!Number.isSafeInteger(batchCapacity) || batchCapacity <= 0 || batchCapacity > capacity) throw new TypeError('resident frontier batch capacity is invalid');
  const normalizedGrid = normalizeGrid(grid), limits = { ...requiredLimits }, residentDeviceCache = deviceCache || createWebGpuDeviceCache({ gpu, requiredLimits: limits });
  let resources = null, pieceIds = null, epoch = 0, residentCount = 0, layer = null;
  const reset = () => { destroyResources(resources); resources = null; pieceIds = null; epoch = 0; residentCount = 0; layer = null; residentDeviceCache.reset(); };
  const availability = async () => { const probe = await probeWebGpuCapabilities({ gpu, requiredLimits: limits }); return probe.adapterAvailable && probe.requiredLimitsSatisfied ? Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'available', backend: 'webgpu', capacity, batchCapacity, grid: normalizedGrid }) : Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable', capacity, batchCapacity, grid: normalizedGrid }); };
  const beginLayer = () => { if (layer) throw new Error('resident frontier layer is already active'); layer = { nextSlot: 0, pieceIds: null, pendingEpoch: epoch + 1 }; return Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'layer-open', epoch, nextEpoch: layer.pendingEpoch }); };
  const commitLayer = () => { if (!layer) return Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'idle', epoch }); const committed = Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'layer-committed', epoch: layer.pendingEpoch, outputCount: layer.nextSlot }); epoch = layer.pendingEpoch; residentCount = layer.nextSlot; layer = null; if (resources) { const old = resources.buffers.residentParents; resources.buffers.residentParents = resources.buffers.residentNext; resources.buffers.residentNext = old; const bindingBuffers = [resources.buffers.seedParents, resources.buffers.candidateMasks, resources.buffers.candidatePieceIndices, resources.buffers.remainingMasks, resources.buffers.nextLabels, resources.buffers.canonicalLabels, resources.buffers.digests, resources.buffers.params, resources.buffers.residentParents, resources.buffers.residentNext, resources.buffers.residentCanonical, resources.buffers.parentStateIndices, resources.buffers.outputStateIndices]; resources.bindGroup = resources.device.createBindGroup({ layout: resources.pipeline.getBindGroupLayout(0), entries: bindingBuffers.map((buffer, binding) => ({ binding, resource: { buffer } })) }); } return committed; };
  return Object.freeze({
    schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA,
    availability,
    beginLayer,
    commitLayer,
    reset,
    epoch: () => epoch,
    async transition(candidates, { verifyParity = true } = {}) {
      const normalized = normalizeCandidates(candidates, normalizedGrid), cpu = verifyParity ? cpuTransitionLabeledFrontierStates(candidates, normalizedGrid) : null, parentReference = parentReferenceReceipt(normalized);
      if (!layer) beginLayer();
      if (!pieceIds) pieceIds = normalized[0].pieceIds;
      if (JSON.stringify(pieceIds) !== JSON.stringify(normalized[0].pieceIds)) return unavailable('piece-id-set-changed', cpu || { pieceIds, nextLabels: [], canonicalLabels: [], absoluteHashes: [], canonicalHashes: [], candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, pieceCount: pieceIds.length }, { parentReference });
      if (layer.pieceIds && JSON.stringify(layer.pieceIds) !== JSON.stringify(normalized[0].pieceIds)) return unavailable('layer-piece-id-set-changed', cpu || { pieceIds, nextLabels: [], canonicalLabels: [], absoluteHashes: [], canonicalHashes: [], candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, pieceCount: pieceIds.length }, { parentReference });
      layer.pieceIds = normalized[0].pieceIds;
      const fallbackCpu = () => cpu || { pieceIds, nextLabels: [], canonicalLabels: [], absoluteHashes: [], canonicalHashes: [], candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, pieceCount: pieceIds.length };
      if (layer.nextSlot + normalized.length > capacity) return unavailable('resident-frontier-capacity-exceeded', fallbackCpu(), { capacity, epoch: layer.pendingEpoch, parentReference });
      const status = await availability(); if (status.status !== 'available') return unavailable(status.reason, fallbackCpu(), { capacity, epoch: layer.pendingEpoch, parentReference });
      try {
        const device = await residentDeviceCache.getDevice();
        if (!resources) { resources = makeResources(device, capacity, batchCapacity, pieceIds.length, normalizedGrid, shaderSource); resources.device = device; }
        if (resources.pieceCount !== pieceIds.length || resources.grid.wordCount !== normalizedGrid.wordCount) { reset(); return unavailable('resident-frontier-shape-changed', fallbackCpu(), { parentReference }); }
        for (const candidate of normalized) if (candidate.parentStateIndex != null && candidate.parentStateIndex >= residentCount) return unavailable('resident-parent-reference-not-in-input-layer', fallbackCpu(), { capacity, epoch: layer.pendingEpoch, residentCount, parentReference });
        const nextLabels = [], canonicalLabels = [], absoluteHashes = [], canonicalHashes = [], residentStateIndices = [], append = (target, values) => { for (const value of values) target.push(value); };
        for (let offset = 0; offset < normalized.length; offset += batchCapacity) { const batch = normalized.slice(offset, offset + batchCapacity), outputIndices = batch.map((_, index) => layer.nextSlot + offset + index); const result = await dispatch(device, resources, batch, pieceIds, outputIndices, normalizedGrid, { readLabels: verifyParity }); append(nextLabels, result.nextLabels); append(canonicalLabels, result.canonicalLabels); append(absoluteHashes, result.absoluteHashes); append(canonicalHashes, result.canonicalHashes); append(residentStateIndices, outputIndices); }
        if (verifyParity) {
          const actual = { nextLabels, canonicalLabels, absoluteHashes, canonicalHashes }, expected = { nextLabels: cpu.nextLabels, canonicalLabels: cpu.canonicalLabels, absoluteHashes: cpu.absoluteHashes, canonicalHashes: cpu.canonicalHashes };
          if (!equalArrays(nextLabels, cpu.nextLabels) || !equalArrays(canonicalLabels, cpu.canonicalLabels) || !equalArrays(absoluteHashes, cpu.absoluteHashes) || !equalArrays(canonicalHashes, cpu.canonicalHashes)) return unavailable(parityMismatchReason(actual, expected, { labelsPerState: cpu.pieceCount * cpu.wordCount, pieceCount: cpu.pieceCount, wordCount: cpu.wordCount, parentStateIndices: normalized.map(candidate => candidate.parentStateIndex), candidatePieceIndices: normalized.map(candidate => candidate.candidatePieceIndex), seedParents: normalized.map(candidate => candidate.parentLabelMasks), candidateMasks: normalized.map(candidate => candidate.candidateMask) }), cpu, { capacity, epoch: layer.pendingEpoch, parentReference });
        }
        layer.nextSlot += normalized.length;
        return Object.freeze({ schema: WEBGPU_LABELED_FRONTIER_STATE_SCHEMA, status: 'completed', backend: 'webgpu', pieceIds, nextLabels, canonicalLabels, absoluteHashes, canonicalHashes, candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, pieceCount: pieceIds.length, parity: verifyParity ? 'verified' : 'deferred', persistent: true, resident: true, residentEpoch: layer.pendingEpoch, residentStateIndices, bufferCapacity: capacity, batchCapacity, parentReference, readback: verifyParity ? 'full-labels-and-digests' : 'state-digests-only' });
      } catch (error) { reset(); return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, fallbackCpu(), { parentReference }); }
    },
  });
}

export { SHADER as DEFAULT_RESIDENT_SHADER };
