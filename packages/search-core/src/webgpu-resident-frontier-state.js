import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { DEFAULT_FRONTIER_GRID } from './webgpu-frontier-validator.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js?v=20260810-limits1';
import { REMAINING_MASK_WORD_COUNT, WEBGPU_LABELED_FRONTIER_STATE_SCHEMA, cpuTransitionLabeledFrontierStates } from './webgpu-labeled-frontier-state.js';

export const WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA = 'tdotdh.webgpu-resident-frontier-state.v0';
export const WEBGPU_RESIDENT_PARENT_REFERENCE_SCHEMA = 'tdotdh.webgpu-resident-parent-reference.v0';
export const WEBGPU_RESIDENT_DIGEST_SCHEMA = 'tdotdh.webgpu-resident-digest.v0';
export const DEFAULT_RESIDENT_FRONTIER_CAPACITY = 4096;
// Keep intermediate frontier transitions GPU-resident in large enough chunks
// to avoid a queue wait and mapped readback for every small beam slice. The
// resident pool remains bounded at 4096 states; 512 is below the 32 MiB
// storage-binding limit for the specialized 64x64 state layout.
export const DEFAULT_RESIDENT_FRONTIER_BATCH_CAPACITY = 1024;

const RESIDENT_PARENT_SENTINEL = 0xffffffff;

const GATHER_SHADER = `
struct Params { candidateCount: u32, labelsPerState: u32, reserved0: u32, reserved1: u32 };
@group(0) @binding(0) var<storage, read> residentParents: array<u32>;
@group(0) @binding(1) var<storage, read> parentStateIndices: array<u32>;
@group(0) @binding(2) var<storage, read_write> seedParents: array<u32>;
@group(0) @binding(3) var<storage, read> params: Params;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let count = params.candidateCount * params.labelsPerState;
  if (id.x >= count) { return; }
  let candidate = id.x / params.labelsPerState;
  let offset = id.x % params.labelsPerState;
  let parentIndex = parentStateIndices[candidate];
  if (parentIndex != ${RESIDENT_PARENT_SENTINEL}u) { seedParents[id.x] = residentParents[parentIndex * params.labelsPerState + offset]; }
}`;

const PUBLISH_SHADER = `
struct Params { candidateCount: u32, labelsPerState: u32, reserved0: u32, reserved1: u32 };
@group(0) @binding(0) var<storage, read> source: array<u32>;
@group(0) @binding(1) var<storage, read> outputStateIndices: array<u32>;
@group(0) @binding(2) var<storage, read_write> residentParents: array<u32>;
@group(0) @binding(3) var<storage, read> params: Params;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let count = params.candidateCount * params.labelsPerState;
  if (id.x >= count) { return; }
  let candidate = id.x / params.labelsPerState;
  let offset = id.x % params.labelsPerState;
  let destination = outputStateIndices[candidate] * params.labelsPerState + offset;
  residentParents[destination] = source[id.x];
}`;

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
  // Keep the resident-parent binding live even though the gather pass resolves
  // child parents into the scratch source. The write is intentionally confined
  // to the redundant residentNext mirror and never affects the canonical state.
  if (parentIndex != ${RESIDENT_PARENT_SENTINEL}u && residentParents[residentParentBase] == ${RESIDENT_PARENT_SENTINEL}u) {
    residentNext[residentOutputBase] = ${RESIDENT_PARENT_SENTINEL}u;
  }
  for (var piece: u32 = 0u; piece < params.pieceCount; piece++) {
    for (var word: u32 = 0u; word < labelStride; word++) {
      let localOffset = localBase + piece * labelStride + word;
      // The gather pass resolves resident parents into resolvedParents before this
      // transition. Keep the index/arena bindings live for stable layouts, but
      // consume one canonical parent source in the main pass.
      var parentValue = seedParents[parentBase + piece * labelStride + word];
      let candidateValue = select(0u, candidateMasks[candidateMaskBase + word], piece == pieceIndex);
      nextLabels[localOffset] = parentValue | candidateValue;
      canonicalLabels[localOffset] = 0u;
    }
  }
  let rowWordCount = (params.width + 31u) / 32u;
  var found = false;
  var minX: i32 = i32(params.width);
  var minY: i32 = i32(params.height);
  for (var y: u32 = 0u; y < params.height; y++) {
    for (var piece: u32 = 0u; piece < params.pieceCount; piece++) {
      let rowBase = localBase + piece * labelStride + y * rowWordCount;
      for (var word: u32 = 0u; word < rowWordCount; word++) {
        let value = nextLabels[rowBase + word];
        if (value != 0u) {
          found = true;
          minY = min(minY, i32(y));
          for (var bit: u32 = 0u; bit < 32u; bit++) {
            if (word * 32u + bit < params.width && ((value >> bit) & 1u) == 1u) {
              minX = min(minX, i32(word * 32u + bit));
              break;
            }
          }
        }
      }
    }
  }
  if (found) {
    let shiftWords = u32(minX) / 32u;
    let shiftBits = u32(minX) % 32u;
    for (var piece: u32 = 0u; piece < params.pieceCount; piece++) {
      for (var sourceY: u32 = 0u; sourceY < params.height; sourceY++) {
        let destinationY = i32(sourceY) - minY;
        if (destinationY >= 0 && destinationY < i32(params.height)) {
          let sourceBase = localBase + piece * labelStride + sourceY * rowWordCount;
          let destinationBase = localBase + piece * labelStride + u32(destinationY) * rowWordCount;
          for (var sourceWord: u32 = 0u; sourceWord < rowWordCount; sourceWord++) {
            if (sourceWord >= shiftWords) {
              let value = nextLabels[sourceBase + sourceWord];
              let destinationWord = sourceWord - shiftWords;
              if (destinationWord < rowWordCount) {
                if (shiftBits == 0u) {
                  canonicalLabels[destinationBase + destinationWord] = canonicalLabels[destinationBase + destinationWord] | value;
                } else {
                  canonicalLabels[destinationBase + destinationWord] = canonicalLabels[destinationBase + destinationWord] | (value >> shiftBits);
                  if (destinationWord > 0u) {
                    canonicalLabels[destinationBase + destinationWord - 1u] = canonicalLabels[destinationBase + destinationWord - 1u] | (value << (32u - shiftBits));
                  }
                }
              }
            }
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

function flatten(candidates, property, width) {
  const flat = new Uint32Array(candidates.length * width);
  for (let index = 0; index < candidates.length; index += 1) flat.set(candidates[index][property], index * width);
  return flat;
}

function uint32Values(values, property = null) {
  const flat = new Uint32Array(values.length);
  for (let index = 0; index < values.length; index += 1) flat[index] = property ? values[index][property] : values[index];
  return flat;
}
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
    seedParents: device.createBuffer({ size: batchLabelsBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }),
    resolvedParents: device.createBuffer({ size: batchLabelsBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }),
    candidateMasks: device.createBuffer({ size: batchMaskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    candidatePieceIndices: device.createBuffer({ size: batchCapacity * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    remainingMasks: device.createBuffer({ size: remainingBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    nextLabels: device.createBuffer({ size: batchLabelsBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    canonicalLabels: device.createBuffer({ size: batchLabelsBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    digests: device.createBuffer({ size: hashBytes * 2, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    params: device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    residentParents: device.createBuffer({ size: residentBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }),
    residentNext: device.createBuffer({ size: residentBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }),
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
  const gatherModule = device.createShaderModule({ code: GATHER_SHADER }), gatherPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: gatherModule, entryPoint: 'main' } });
  const publishModule = device.createShaderModule({ code: PUBLISH_SHADER }), publishPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: publishModule, entryPoint: 'main' } });
  const module = device.createShaderModule({ code: specializedShader }), pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const bindingBuffers = [buffers.resolvedParents, buffers.candidateMasks, buffers.candidatePieceIndices, buffers.remainingMasks, buffers.nextLabels, buffers.canonicalLabels, buffers.digests, buffers.params, buffers.residentParents, buffers.residentNext, buffers.residentCanonical, buffers.parentStateIndices, buffers.outputStateIndices];
  const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: bindingBuffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const gatherParams = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const gatherBindGroup = device.createBindGroup({ layout: gatherPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buffers.residentParents } }, { binding: 1, resource: { buffer: buffers.parentStateIndices } }, { binding: 2, resource: { buffer: buffers.resolvedParents } }, { binding: 3, resource: { buffer: gatherParams } }] });
  const publishParams = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  buffers.gatherParams = gatherParams;
  const publishOutputIndices = device.createBuffer({ size: batchCapacity * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  buffers.publishParams = publishParams; buffers.publishOutputIndices = publishOutputIndices;
  const publishBindGroup = device.createBindGroup({ layout: publishPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buffers.nextLabels } }, { binding: 1, resource: { buffer: publishOutputIndices } }, { binding: 2, resource: { buffer: buffers.residentParents } }, { binding: 3, resource: { buffer: publishParams } }] });
  return { capacity, batchCapacity, pieceCount, grid, labelsPerState, buffers, pipeline, bindGroup, gatherPipeline, gatherBindGroup, publishPipeline, publishBindGroup };
}

function destroyResources(resources) { if (resources) Object.values(resources.buffers).forEach(buffer => buffer.destroy()); }

async function readback(buffer, bytes) { await buffer.mapAsync(GPUMapMode.READ); const values = Array.from(new Uint32Array(buffer.getMappedRange().slice(0, bytes))); buffer.unmap(); return values; }

async function dispatch(device, resources, candidates, pieceIds, outputIndices, grid, { readLabels = true, readDigests = true, digestGeneration = 0 } = {}) {
  const dispatchStarted = performance.now();
  const { buffers, pipeline, bindGroup, labelsPerState } = resources, count = candidates.length, labelBytes = count * labelsPerState * 4, maskBytes = count * grid.wordCount * 4, hashBytes = count * 4, digestBytes = hashBytes * 2;
  // Resident children read their parent labels from residentParents. Roots
  // read the explicit seed buffer; do not write and read residentParents in
  // the same dispatch. Avoiding the full seed transfer is the fast path once
  // a beam layer is resident on the GPU.
  device.queue.writeBuffer(buffers.candidateMasks, 0, flatten(candidates, 'candidateMask', grid.wordCount));
  device.queue.writeBuffer(buffers.candidatePieceIndices, 0, uint32Values(candidates, 'candidatePieceIndex'));
  device.queue.writeBuffer(buffers.remainingMasks, 0, flatten(candidates, 'remainingMask', REMAINING_MASK_WORD_COUNT));
  const parentStateIndices = uint32Values(candidates.map(candidate => candidate.parentStateIndex == null ? RESIDENT_PARENT_SENTINEL : candidate.parentStateIndex));
  device.queue.writeBuffer(buffers.parentStateIndices, 0, parentStateIndices);
  device.queue.writeBuffer(buffers.gatherParams, 0, new Uint32Array([count, labelsPerState, 0, 0]));
  const outputStateIndices = outputIndices instanceof Uint32Array ? outputIndices : uint32Values(outputIndices);
  device.queue.writeBuffer(buffers.outputStateIndices, 0, outputStateIndices);
  device.queue.writeBuffer(buffers.publishOutputIndices, 0, outputStateIndices);
  device.queue.writeBuffer(buffers.publishParams, 0, new Uint32Array([count, labelsPerState, 0, 0]));
  device.queue.writeBuffer(buffers.params, 0, new Int32Array([count, grid.wordCount, pieceIds.length, grid.width, grid.height, grid.originX, grid.originY, 0]));
  const uploadMs = performance.now() - dispatchStarted;
  if (parentStateIndices.some(index => index !== RESIDENT_PARENT_SENTINEL)) {
    const gatherEncoder = device.createCommandEncoder(), gatherPass = gatherEncoder.beginComputePass();
    gatherPass.setPipeline(resources.gatherPipeline); gatherPass.setBindGroup(0, resources.gatherBindGroup); gatherPass.dispatchWorkgroups(Math.ceil(count * labelsPerState / 64)); gatherPass.end();
    device.queue.submit([gatherEncoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  for (let index = 0; index < parentStateIndices.length; index++) {
    if (parentStateIndices[index] === RESIDENT_PARENT_SENTINEL) {
      device.queue.writeBuffer(buffers.seedParents, index * labelsPerState * 4, candidates[index].parentLabelMasks);
    }
  }
  const encoder = device.createCommandEncoder();
  for (let index = 0; index < parentStateIndices.length; index++) {
    if (parentStateIndices[index] === RESIDENT_PARENT_SENTINEL) encoder.copyBufferToBuffer(buffers.seedParents, index * labelsPerState * 4, buffers.resolvedParents, index * labelsPerState * 4, labelsPerState * 4);
  }
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end();
  if (readLabels) {
    encoder.copyBufferToBuffer(buffers.nextLabels, 0, buffers.nextReadback, 0, labelBytes);
    encoder.copyBufferToBuffer(buffers.canonicalLabels, 0, buffers.canonicalReadback, 0, labelBytes);
  }
  if (readDigests) encoder.copyBufferToBuffer(buffers.digests, 0, buffers.digestReadback, 0, digestBytes);
  const beforeSubmit = performance.now();
  device.queue.submit([encoder.finish()]);
  const publishEncoder = device.createCommandEncoder(), publishPass = publishEncoder.beginComputePass();
  publishPass.setPipeline(resources.publishPipeline); publishPass.setBindGroup(0, resources.publishBindGroup); publishPass.dispatchWorkgroups(Math.ceil(count * labelsPerState / 64)); publishPass.end();
  device.queue.submit([publishEncoder.finish()]);
  const submitMs = performance.now() - beforeSubmit;
  const completion = device.queue.onSubmittedWorkDone();
  const [nextLabels, canonicalLabels, digestValues, _completion] = await Promise.all([
    readLabels ? readback(buffers.nextReadback, labelBytes) : Promise.resolve([]),
    readLabels ? readback(buffers.canonicalReadback, labelBytes) : Promise.resolve([]),
    readDigests ? readback(buffers.digestReadback, digestBytes) : Promise.resolve([]),
    completion,
  ]), readbackMs = performance.now() - beforeSubmit - submitMs, absoluteHashes = [], canonicalHashes = [];
  for (let index = 0; index < count; index++) { if (readDigests) { absoluteHashes.push(digestValues[index * 2]); canonicalHashes.push(digestValues[index * 2 + 1]); } }
  return { nextLabels, canonicalLabels, absoluteHashes, canonicalHashes, readback: readLabels ? 'full-labels-and-digests' : readDigests ? 'state-digests-only' : 'resident-digests', ...(readDigests ? {} : { residentDigestRef: Object.freeze({ schema: WEBGPU_RESIDENT_DIGEST_SCHEMA, device, buffer: resources.buffers.digests, offsetWords: 0, strideWords: 2, count, generation: digestGeneration }) }), dispatchTimings: { uploadMs: Number(uploadMs.toFixed(2)), submitMs: Number(submitMs.toFixed(2)), readbackMs: Number(readbackMs.toFixed(2)), totalMs: Number((performance.now() - dispatchStarted).toFixed(2)) } };
}

/**
 * A monotonic GPU frontier pool. `beginLayer` reserves the next append range,
 * `transition` writes children into a scratch output buffer and publishes them
 * into the stable parent arena with an explicit queue completion edge, and
 * `commitLayer` publishes the range. Parent references therefore remain stable
 * across every beam layer and resumable cursor; only canonical replay arrays
 * and hashes are read back for admission.
 */
export function createWebGpuResidentFrontierState({ gpu = globalThis.navigator?.gpu, grid = DEFAULT_FRONTIER_GRID, deviceCache = null, capacity = DEFAULT_RESIDENT_FRONTIER_CAPACITY, batchCapacity = DEFAULT_RESIDENT_FRONTIER_BATCH_CAPACITY, requiredLimits = { maxStorageBufferBindingSize: 33554432, maxStorageBuffersPerShaderStage: 14 }, shaderSource = SHADER } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new TypeError('resident frontier capacity must be a positive safe integer');
  if (!Number.isSafeInteger(batchCapacity) || batchCapacity <= 0 || batchCapacity > capacity) throw new TypeError('resident frontier batch capacity is invalid');
  const normalizedGrid = normalizeGrid(grid), limits = { ...requiredLimits }, residentDeviceCache = deviceCache || createWebGpuDeviceCache({ gpu, requiredLimits: limits });
  let resources = null, pieceIds = null, epoch = 0, residentCount = 0, layer = null;
  let dispatchTimingTotals = { calls: 0, uploadMs: 0, submitMs: 0, readbackMs: 0, totalMs: 0 };
  const reset = () => { destroyResources(resources); resources = null; pieceIds = null; epoch = 0; residentCount = 0; layer = null; dispatchTimingTotals = { calls: 0, uploadMs: 0, submitMs: 0, readbackMs: 0, totalMs: 0 }; residentDeviceCache.reset(); };
  const availability = async () => { const probe = await probeWebGpuCapabilities({ gpu, requiredLimits: limits }); return probe.adapterAvailable && probe.requiredLimitsSatisfied ? Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'available', backend: 'webgpu', capacity, batchCapacity, grid: normalizedGrid }) : Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable', capacity, batchCapacity, grid: normalizedGrid }); };
  const beginLayer = () => { if (layer) throw new Error('resident frontier layer is already active'); layer = { baseSlot: residentCount, nextSlot: 0, pieceIds: null, pendingEpoch: epoch + 1 }; return Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'layer-open', epoch, nextEpoch: layer.pendingEpoch, baseSlot: layer.baseSlot }); };
  const commitLayer = () => { if (!layer) return Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'idle', epoch }); const committed = Object.freeze({ schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA, status: 'layer-committed', epoch: layer.pendingEpoch, baseSlot: layer.baseSlot, outputCount: layer.nextSlot }); epoch = layer.pendingEpoch; residentCount = layer.baseSlot + layer.nextSlot; layer = null; if (resources) { const bindingBuffers = [resources.buffers.resolvedParents, resources.buffers.candidateMasks, resources.buffers.candidatePieceIndices, resources.buffers.remainingMasks, resources.buffers.nextLabels, resources.buffers.canonicalLabels, resources.buffers.digests, resources.buffers.params, resources.buffers.residentParents, resources.buffers.residentNext, resources.buffers.residentCanonical, resources.buffers.parentStateIndices, resources.buffers.outputStateIndices]; resources.bindGroup = resources.device.createBindGroup({ layout: resources.pipeline.getBindGroupLayout(0), entries: bindingBuffers.map((buffer, binding) => ({ binding, resource: { buffer } })) }); resources.gatherBindGroup = resources.device.createBindGroup({ layout: resources.gatherPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: resources.buffers.residentParents } }, { binding: 1, resource: { buffer: resources.buffers.parentStateIndices } }, { binding: 2, resource: { buffer: resources.buffers.resolvedParents } }, { binding: 3, resource: { buffer: resources.buffers.gatherParams } }] }); resources.publishBindGroup = resources.device.createBindGroup({ layout: resources.publishPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: resources.buffers.nextLabels } }, { binding: 1, resource: { buffer: resources.buffers.publishOutputIndices } }, { binding: 2, resource: { buffer: resources.buffers.residentParents } }, { binding: 3, resource: { buffer: resources.buffers.publishParams } }] }); } return committed; };
  return Object.freeze({
    schema: WEBGPU_RESIDENT_FRONTIER_STATE_SCHEMA,
    availability,
    beginLayer,
    commitLayer,
    reset,
    epoch: () => epoch,
    async transition(candidates, { verifyParity = true, readDigests = true } = {}) {
      const normalized = normalizeCandidates(candidates, normalizedGrid), cpu = verifyParity ? cpuTransitionLabeledFrontierStates(candidates, normalizedGrid) : null, parentReference = parentReferenceReceipt(normalized);
      if (!layer) beginLayer();
      if (!pieceIds) pieceIds = normalized[0].pieceIds;
      if (JSON.stringify(pieceIds) !== JSON.stringify(normalized[0].pieceIds)) return unavailable('piece-id-set-changed', cpu || { pieceIds, nextLabels: [], canonicalLabels: [], absoluteHashes: [], canonicalHashes: [], candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, pieceCount: pieceIds.length }, { parentReference });
      if (layer.pieceIds && JSON.stringify(layer.pieceIds) !== JSON.stringify(normalized[0].pieceIds)) return unavailable('layer-piece-id-set-changed', cpu || { pieceIds, nextLabels: [], canonicalLabels: [], absoluteHashes: [], canonicalHashes: [], candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, pieceCount: pieceIds.length }, { parentReference });
      layer.pieceIds = normalized[0].pieceIds;
      const fallbackCpu = () => cpu || { pieceIds, nextLabels: [], canonicalLabels: [], absoluteHashes: [], canonicalHashes: [], candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, pieceCount: pieceIds.length };
      if (layer.baseSlot + layer.nextSlot + normalized.length > capacity) return unavailable('resident-frontier-capacity-exceeded', fallbackCpu(), { capacity, epoch: layer.pendingEpoch, residentCount, parentReference });
      const status = await availability(); if (status.status !== 'available') return unavailable(status.reason, fallbackCpu(), { capacity, epoch: layer.pendingEpoch, parentReference });
      try {
        const device = await residentDeviceCache.getDevice();
        if (!resources) { resources = makeResources(device, capacity, batchCapacity, pieceIds.length, normalizedGrid, shaderSource); resources.device = device; }
        if (resources.pieceCount !== pieceIds.length || resources.grid.wordCount !== normalizedGrid.wordCount) { reset(); return unavailable('resident-frontier-shape-changed', fallbackCpu(), { parentReference }); }
        for (const candidate of normalized) if (candidate.parentStateIndex != null && candidate.parentStateIndex >= residentCount) return unavailable('resident-parent-reference-not-in-input-layer', fallbackCpu(), { capacity, epoch: layer.pendingEpoch, residentCount, parentReference });
        const nextLabels = [], canonicalLabels = [], absoluteHashes = [], canonicalHashes = [], residentStateIndices = [], dispatchTimings = { calls: 0, uploadMs: 0, submitMs: 0, readbackMs: 0, totalMs: 0 }, append = (target, values) => { for (const value of values) target.push(value); };
        const deferDigests = readDigests === false && verifyParity !== true && normalized.length <= batchCapacity;
        let residentDigestRef = null;
        for (let offset = 0; offset < normalized.length; offset += batchCapacity) { const batch = normalized.slice(offset, offset + batchCapacity), outputIndices = new Uint32Array(batch.length); for (let index = 0; index < outputIndices.length; index += 1) outputIndices[index] = layer.baseSlot + layer.nextSlot + offset + index; const result = await dispatch(device, resources, batch, pieceIds, outputIndices, normalizedGrid, { readLabels: verifyParity, readDigests: !deferDigests, digestGeneration: layer.pendingEpoch }); append(nextLabels, result.nextLabels); append(canonicalLabels, result.canonicalLabels); append(absoluteHashes, result.absoluteHashes); append(canonicalHashes, result.canonicalHashes); append(residentStateIndices, outputIndices); if (result.residentDigestRef) residentDigestRef = result.residentDigestRef; for (const name of ['uploadMs', 'submitMs', 'readbackMs', 'totalMs']) { dispatchTimings[name] += result.dispatchTimings?.[name] || 0; dispatchTimingTotals[name] += result.dispatchTimings?.[name] || 0; } dispatchTimings.calls += 1; dispatchTimingTotals.calls += 1; }
        if (verifyParity) {
          const actual = { nextLabels, canonicalLabels, absoluteHashes, canonicalHashes }, expected = { nextLabels: cpu.nextLabels, canonicalLabels: cpu.canonicalLabels, absoluteHashes: cpu.absoluteHashes, canonicalHashes: cpu.canonicalHashes };
          if (!equalArrays(nextLabels, cpu.nextLabels) || !equalArrays(canonicalLabels, cpu.canonicalLabels) || !equalArrays(absoluteHashes, cpu.absoluteHashes) || !equalArrays(canonicalHashes, cpu.canonicalHashes)) return unavailable(parityMismatchReason(actual, expected, { labelsPerState: cpu.pieceCount * cpu.wordCount, pieceCount: cpu.pieceCount, wordCount: cpu.wordCount, parentStateIndices: normalized.map(candidate => candidate.parentStateIndex), candidatePieceIndices: normalized.map(candidate => candidate.candidatePieceIndex), seedParents: normalized.map(candidate => candidate.parentLabelMasks), candidateMasks: normalized.map(candidate => candidate.candidateMask) }), cpu, { capacity, epoch: layer.pendingEpoch, residentCount, parentReference });
        }
        layer.nextSlot += normalized.length;
        return Object.freeze({ schema: WEBGPU_LABELED_FRONTIER_STATE_SCHEMA, status: 'completed', backend: 'webgpu', pieceIds, nextLabels, canonicalLabels, absoluteHashes, canonicalHashes, candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, pieceCount: pieceIds.length, parity: verifyParity ? 'verified' : 'deferred', persistent: true, resident: true, residentEpoch: layer.pendingEpoch, residentStateIndices, bufferCapacity: capacity, batchCapacity, parentReference, readback: residentDigestRef ? 'resident-digests' : verifyParity ? 'full-labels-and-digests' : 'state-digests-only', ...(residentDigestRef ? { residentDigestRef } : {}), dispatchTimings, dispatchTimingTotals: { ...dispatchTimings } });
      } catch (error) { reset(); return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, fallbackCpu(), { parentReference }); }
    },
  });
}

export { SHADER as DEFAULT_RESIDENT_SHADER };
