import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA = 'tdotdh.webgpu-frontier-deduplicator.v0';
export const MAX_FRONTIER_DEDUP_ROWS = 4096;
export const FRONTIER_DEDUP_WORKGROUP_SIZE = 64;

export const DEFAULT_SHADER = `
struct Params { rowCount: u32, tableMask: u32, reserved0: u32, reserved1: u32, };
@group(0) @binding(0) var<storage, read> hashes: array<u32>;
@group(0) @binding(1) var<storage, read_write> table: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read> fingerprints: array<vec4<u32>>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(${FRONTIER_DEDUP_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.rowCount) { return; }
  var slot = hashes[index] & params.tableMask;
  let fingerprint = fingerprints[index];
  loop {
    let prior = atomicLoad(&table[slot]);
    if (prior == 0u) {
      let claimed = atomicCompareExchangeWeak(&table[slot], 0u, index + 1u);
      if (claimed.exchanged) { break; }
    } else {
      let priorIndex = prior - 1u;
      let priorFingerprint = fingerprints[priorIndex];
      if (all(priorFingerprint == fingerprint)) { atomicMin(&table[slot], index + 1u); break; }
    }
    slot = (slot + 1u) & params.tableMask;
  }
}`;
export const FINALIZE_SHADER = `
struct Params { rowCount: u32, tableMask: u32, reserved0: u32, reserved1: u32, };
@group(0) @binding(0) var<storage, read> hashes: array<u32>;
@group(0) @binding(1) var<storage, read_write> table: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read> fingerprints: array<vec4<u32>>;
@group(0) @binding(3) var<storage, read_write> keep: array<u32>;
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(${FRONTIER_DEDUP_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.rowCount) { return; }
  var slot = hashes[index] & params.tableMask;
  let fingerprint = fingerprints[index];
  loop {
    let prior = atomicLoad(&table[slot]);
    if (prior == 0u) { keep[index] = 0u; break; }
    let priorFingerprint = fingerprints[prior - 1u];
    if (all(priorFingerprint == fingerprint)) { keep[index] = select(0u, 1u, prior == index + 1u); break; }
    slot = (slot + 1u) & params.tableMask;
  }
}`;

export const RESIDENT_SHADER = `
struct Params { rowCount: u32, tableMask: u32, digestBase: u32, digestStride: u32, };
@group(0) @binding(0) var<storage, read> digests: array<u32>;
@group(0) @binding(1) var<storage, read> groupIds: array<u32>;
@group(0) @binding(2) var<storage, read> sourceIndices: array<u32>;
@group(0) @binding(3) var<storage, read_write> table: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> fingerprints: array<vec4<u32>>;
@group(0) @binding(5) var<uniform> params: Params;

@compute @workgroup_size(${FRONTIER_DEDUP_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.rowCount) { return; }
  let digest = digests[params.digestBase + sourceIndices[index] * params.digestStride];
  var slot = (digest ^ ((groupIds[index] + 1u) * 0x9e3779b9u)) & params.tableMask;
  let fingerprint = fingerprints[index];
  loop {
    let prior = atomicLoad(&table[slot]);
    if (prior == 0u) {
      let claimed = atomicCompareExchangeWeak(&table[slot], 0u, index + 1u);
      if (claimed.exchanged) { break; }
    } else {
      let priorIndex = prior - 1u;
      let priorFingerprint = fingerprints[priorIndex];
      if (all(priorFingerprint == fingerprint)) { atomicMin(&table[slot], index + 1u); break; }
    }
    slot = (slot + 1u) & params.tableMask;
  }
}`;

export const RESIDENT_FINALIZE_SHADER = `
struct Params { rowCount: u32, tableMask: u32, digestBase: u32, digestStride: u32, };
@group(0) @binding(0) var<storage, read> digests: array<u32>;
@group(0) @binding(1) var<storage, read> groupIds: array<u32>;
@group(0) @binding(2) var<storage, read> sourceIndices: array<u32>;
@group(0) @binding(3) var<storage, read_write> table: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> fingerprints: array<vec4<u32>>;
@group(0) @binding(5) var<storage, read_write> keep: array<u32>;
@group(0) @binding(6) var<uniform> params: Params;

@compute @workgroup_size(${FRONTIER_DEDUP_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.rowCount) { return; }
  let digest = digests[params.digestBase + sourceIndices[index] * params.digestStride];
  var slot = (digest ^ ((groupIds[index] + 1u) * 0x9e3779b9u)) & params.tableMask;
  let fingerprint = fingerprints[index];
  loop {
    let prior = atomicLoad(&table[slot]);
    if (prior == 0u) { keep[index] = 0u; break; }
    let priorFingerprint = fingerprints[prior - 1u];
    if (all(priorFingerprint == fingerprint)) { keep[index] = select(0u, 1u, prior == index + 1u); break; }
    slot = (slot + 1u) & params.tableMask;
  }
}`;

function normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_FRONTIER_DEDUP_ROWS) throw new TypeError(`frontier dedup rows must contain 1-${MAX_FRONTIER_DEDUP_ROWS} rows`);
  return rows.map((row, index) => {
    const hash = Number(row?.hash), signature = row?.signature;
    if (!Number.isSafeInteger(hash) || hash < 0 || hash > 0xffffffff) throw new TypeError(`frontier dedup row ${index}.hash must be a uint32`);
    if (typeof signature !== 'string' || !signature) throw new TypeError(`frontier dedup row ${index}.signature must be a non-empty string`);
    return Object.freeze({ hash: hash >>> 0, signature, fingerprint: signatureFingerprint(signature) });
  });
}

function signatureFingerprint(signature) {
  let a = 2166136261, b = 374761393, c = 668265263, d = 2246822519;
  for (let index = 0; index < signature.length; index++) {
    const code = signature.charCodeAt(index), salt = (code + index) >>> 0;
    a = Math.imul(a ^ code, 16777619) >>> 0;
    b = Math.imul(b ^ salt, 3266489917) >>> 0;
    c = Math.imul(c ^ ((code << 1) | (code >>> 15)), 2246822519) >>> 0;
    d = Math.imul(d ^ (salt ^ (a >>> 13)), 668265263) >>> 0;
  }
  return Object.freeze([a >>> 0, b >>> 0, c >>> 0, d >>> 0]);
}

export function cpuDeduplicateFrontierStates(rows) {
  const normalized = normalizeRows(rows), seen = new Set(), keep = normalized.map(row => {
    if (seen.has(row.signature)) return 0;
    seen.add(row.signature);
    return 1;
  });
  return Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'completed', backend: 'cpu-oracle', parity: 'oracle', keep: Object.freeze(keep), candidateCount: normalized.length });
}

function unavailable(reason, cpu) {
  return Object.freeze({ ...cpu, schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason) });
}

async function runGpu(device, rows, shaderSource) {
  const bytes = Math.max(4, rows.length * 4), tableSize = nextPowerOfTwo(Math.max(2, rows.length * 2)), tableBytes = tableSize * 4;
  const hashes = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const keep = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const table = device.createBuffer({ size: tableBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const fingerprints = device.createBuffer({ size: Math.max(16, rows.length * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const readback = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(hashes, 0, Uint32Array.from(rows, row => row.hash));
    device.queue.writeBuffer(fingerprints, 0, Uint32Array.from(rows.flatMap(row => row.fingerprint)));
    device.queue.writeBuffer(table, 0, new Uint32Array(tableSize));
    device.queue.writeBuffer(params, 0, new Uint32Array([rows.length, tableSize - 1, 0, 0]));
    const module = device.createShaderModule({ code: shaderSource });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: hashes } }, { binding: 1, resource: { buffer: table } }, { binding: 2, resource: { buffer: fingerprints } }, { binding: 3, resource: { buffer: params } }] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(rows.length / FRONTIER_DEDUP_WORKGROUP_SIZE)); pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();

    const finalizeModule = device.createShaderModule({ code: FINALIZE_SHADER });
    const finalizePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: finalizeModule, entryPoint: 'main' } });
    const finalizeGroup = device.createBindGroup({ layout: finalizePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: hashes } }, { binding: 1, resource: { buffer: table } }, { binding: 2, resource: { buffer: fingerprints } }, { binding: 3, resource: { buffer: keep } }, { binding: 4, resource: { buffer: params } }] });
    const finalizeEncoder = device.createCommandEncoder(), finalizePass = finalizeEncoder.beginComputePass();
    finalizePass.setPipeline(finalizePipeline); finalizePass.setBindGroup(0, finalizeGroup); finalizePass.dispatchWorkgroups(Math.ceil(rows.length / FRONTIER_DEDUP_WORKGROUP_SIZE)); finalizePass.end();
    finalizeEncoder.copyBufferToBuffer(keep, 0, readback, 0, bytes);
    device.queue.submit([finalizeEncoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await readback.mapAsync(GPUMapMode.READ);
    const result = Array.from(new Uint32Array(readback.getMappedRange().slice(0, rows.length * 4)));
    readback.unmap();
    return result;
  } finally {
    for (const buffer of [hashes, keep, table, fingerprints, params, readback]) buffer.destroy();
  }
}

function nextPowerOfTwo(value) { let result = 1; while (result < value) result *= 2; return result; }

function createPersistentGpuDedupRunner(device, shaderSource) {
  const usage = globalThis.GPUBufferUsage, mapMode = globalThis.GPUMapMode;
  let resources = null, queue = Promise.resolve();
  const destroy = () => {
    if (!resources) return;
    for (const buffer of Object.values(resources.buffers)) buffer.destroy();
    resources = null;
  };
  const ensure = rowCount => {
    const requiredRows = nextPowerOfTwo(Math.max(1, rowCount)), requiredTable = nextPowerOfTwo(Math.max(2, rowCount * 2));
    if (resources && resources.rowCapacity >= requiredRows && resources.tableCapacity >= requiredTable) return resources;
    destroy();
    const buffers = {
      hashes: device.createBuffer({ size: requiredRows * 4, usage: usage.STORAGE | usage.COPY_DST }),
      sourceIndices: device.createBuffer({ size: requiredRows * 4, usage: usage.STORAGE | usage.COPY_DST }),
      keep: device.createBuffer({ size: requiredRows * 4, usage: usage.STORAGE | usage.COPY_SRC }),
      table: device.createBuffer({ size: requiredTable * 4, usage: usage.STORAGE | usage.COPY_DST }),
      fingerprints: device.createBuffer({ size: requiredRows * 16, usage: usage.STORAGE | usage.COPY_DST }),
      params: device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST }),
      readback: device.createBuffer({ size: requiredRows * 4, usage: usage.MAP_READ | usage.COPY_DST }),
    };
    const module = device.createShaderModule({ code: shaderSource }), finalizeModule = device.createShaderModule({ code: FINALIZE_SHADER });
    const residentModule = device.createShaderModule({ code: RESIDENT_SHADER }), residentFinalizeModule = device.createShaderModule({ code: RESIDENT_FINALIZE_SHADER });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const finalizePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: finalizeModule, entryPoint: 'main' } });
    const residentPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: residentModule, entryPoint: 'main' } });
    const residentFinalizePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: residentFinalizeModule, entryPoint: 'main' } });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: buffers.hashes } }, { binding: 1, resource: { buffer: buffers.table } },
      { binding: 2, resource: { buffer: buffers.fingerprints } }, { binding: 3, resource: { buffer: buffers.params } },
    ] });
    const finalizeGroup = device.createBindGroup({ layout: finalizePipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: buffers.hashes } }, { binding: 1, resource: { buffer: buffers.table } },
      { binding: 2, resource: { buffer: buffers.fingerprints } }, { binding: 3, resource: { buffer: buffers.keep } },
      { binding: 4, resource: { buffer: buffers.params } },
    ] });
    resources = { buffers, pipeline, bindGroup, finalizePipeline, finalizeGroup, residentPipeline, residentFinalizePipeline, rowCapacity: requiredRows, tableCapacity: requiredTable };
    return resources;
  };
  const runExclusive = async rows => {
    const current = ensure(rows.length), { buffers } = current;
    device.queue.writeBuffer(buffers.hashes, 0, Uint32Array.from(rows, row => row.hash));
    device.queue.writeBuffer(buffers.fingerprints, 0, Uint32Array.from(rows.flatMap(row => row.fingerprint)));
    device.queue.writeBuffer(buffers.table, 0, new Uint32Array(current.tableCapacity));
    device.queue.writeBuffer(buffers.params, 0, new Uint32Array([rows.length, current.tableCapacity - 1, 0, 0]));
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(current.pipeline); pass.setBindGroup(0, current.bindGroup); pass.dispatchWorkgroups(Math.ceil(rows.length / FRONTIER_DEDUP_WORKGROUP_SIZE)); pass.end();
    const finalizePass = encoder.beginComputePass();
    finalizePass.setPipeline(current.finalizePipeline); finalizePass.setBindGroup(0, current.finalizeGroup); finalizePass.dispatchWorkgroups(Math.ceil(rows.length / FRONTIER_DEDUP_WORKGROUP_SIZE)); finalizePass.end();
    encoder.copyBufferToBuffer(buffers.keep, 0, buffers.readback, 0, rows.length * 4);
    device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    await buffers.readback.mapAsync(mapMode.READ); const result = Array.from(new Uint32Array(buffers.readback.getMappedRange().slice(0, rows.length * 4))); buffers.readback.unmap();
    return result;
  };
  const runResidentExclusive = async (rows, digestRef) => {
    const current = ensure(rows.length), { buffers } = current;
    const residentBindGroup = device.createBindGroup({ layout: current.residentPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: digestRef.buffer } },
      { binding: 1, resource: { buffer: buffers.hashes } }, { binding: 2, resource: { buffer: buffers.sourceIndices } }, { binding: 3, resource: { buffer: buffers.table } },
      { binding: 4, resource: { buffer: buffers.fingerprints } }, { binding: 5, resource: { buffer: buffers.params } },
    ] });
    const residentFinalizeGroup = device.createBindGroup({ layout: current.residentFinalizePipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: digestRef.buffer } },
      { binding: 1, resource: { buffer: buffers.hashes } }, { binding: 2, resource: { buffer: buffers.sourceIndices } }, { binding: 3, resource: { buffer: buffers.table } },
      { binding: 4, resource: { buffer: buffers.fingerprints } }, { binding: 5, resource: { buffer: buffers.keep } },
      { binding: 6, resource: { buffer: buffers.params } },
    ] });
    device.queue.writeBuffer(buffers.hashes, 0, Uint32Array.from(rows, row => row.groupId));
    device.queue.writeBuffer(buffers.sourceIndices, 0, Uint32Array.from(rows, row => row.digestIndex));
    device.queue.writeBuffer(buffers.fingerprints, 0, Uint32Array.from(rows.flatMap(row => row.fingerprint)));
    device.queue.writeBuffer(buffers.table, 0, new Uint32Array(current.tableCapacity));
    device.queue.writeBuffer(buffers.params, 0, new Uint32Array([rows.length, current.tableCapacity - 1, digestRef.offsetWords, digestRef.strideWords]));
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(current.residentPipeline); pass.setBindGroup(0, residentBindGroup); pass.dispatchWorkgroups(Math.ceil(rows.length / FRONTIER_DEDUP_WORKGROUP_SIZE)); pass.end();
    device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    const finalizeEncoder = device.createCommandEncoder(), finalizePass = finalizeEncoder.beginComputePass();
    finalizePass.setPipeline(current.residentFinalizePipeline); finalizePass.setBindGroup(0, residentFinalizeGroup); finalizePass.dispatchWorkgroups(Math.ceil(rows.length / FRONTIER_DEDUP_WORKGROUP_SIZE)); finalizePass.end();
    finalizeEncoder.copyBufferToBuffer(buffers.keep, 0, buffers.readback, 0, rows.length * 4);
    device.queue.submit([finalizeEncoder.finish()]); await device.queue.onSubmittedWorkDone();
    await buffers.readback.mapAsync(mapMode.READ); const result = Array.from(new Uint32Array(buffers.readback.getMappedRange().slice(0, rows.length * 4))); buffers.readback.unmap();
    return result;
  };
  return Object.freeze({
    run(rows) { const task = queue.then(() => runExclusive(rows)); queue = task.catch(() => {}); return task; },
    runResident(rows, digestRef) { const task = queue.then(() => runResidentExclusive(rows, digestRef)); queue = task.catch(() => {}); return task; },
    reset() { queue = Promise.resolve(); destroy(); },
  });
}

export function createWebGpuFrontierDeduplicator({ gpu = globalThis.navigator?.gpu, requiredLimits = { maxComputeWorkgroupSizeX: FRONTIER_DEDUP_WORKGROUP_SIZE }, shaderSource = DEFAULT_SHADER, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  let availabilityPromise = null, persistentRunner = null;
  const availability = async () => {
    if (!availabilityPromise) availabilityPromise = probeWebGpuCapabilities({ gpu, requiredLimits }).then(probe => probe.adapterAvailable && probe.requiredLimitsSatisfied
      ? Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'available', backend: 'webgpu' })
      : Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable' }));
    return availabilityPromise;
  };
  const deduplicateMany = async groups => {
    if (!Array.isArray(groups) || groups.length === 0) throw new TypeError('frontier dedup groups must contain at least one group');
    const normalizedGroups = groups.map((rows, groupIndex) => normalizeRows(rows.map(row => ({ hash: ((Number(row?.hash) >>> 0) ^ Math.imul(groupIndex + 1, 0x9e3779b9)) >>> 0, signature: `${groupIndex}\u0000${row?.signature}` }))));
    const cpuKeeps = normalizedGroups.map(rows => Array.from(cpuDeduplicateFrontierStates(rows).keep)), flatRows = normalizedGroups.flat(), flatExpected = cpuKeeps.flat(), candidateCount = flatRows.length;
    if (candidateCount > MAX_FRONTIER_DEDUP_ROWS) return Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: 'frontier-dedup-batch-capacity', keep: Object.freeze(cpuKeeps), candidateCount, groupCount: groups.length });
    const status = await availability();
    if (status.status !== 'available') return Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: status.reason, keep: Object.freeze(cpuKeeps), candidateCount, groupCount: groups.length });
    try {
      if (!persistentRunner) persistentRunner = createPersistentGpuDedupRunner(await deviceCache.getDevice(), shaderSource);
      const gpuKeep = await persistentRunner.run(flatRows);
      const mismatchIndex = gpuKeep.findIndex((value, index) => value !== flatExpected[index]);
      if (mismatchIndex >= 0) return Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: `oracle-parity-mismatch:${mismatchIndex}:${gpuKeep[mismatchIndex]}!=${flatExpected[mismatchIndex]}`, keep: Object.freeze(cpuKeeps), candidateCount, groupCount: groups.length });
      let offset = 0; const keep = cpuKeeps.map(group => { const result = Object.freeze(gpuKeep.slice(offset, offset + group.length)); offset += group.length; return result; });
      return Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'completed', backend: 'webgpu', parity: 'verified', algorithm: 'stable-open-addressing-fingerprint-min', keep: Object.freeze(keep), candidateCount, groupCount: groups.length });
    } catch (error) {
      persistentRunner?.reset(); persistentRunner = null; deviceCache.reset();
      return Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: `webgpu-execution-failed:${error?.message || String(error)}`, keep: Object.freeze(cpuKeeps), candidateCount, groupCount: groups.length });
    }
  };
  const deduplicateResidentMany = async groups => {
    if (!Array.isArray(groups) || groups.length === 0) throw new TypeError('frontier resident dedup groups must contain at least one group');
    const normalizedGroups = groups.map((rows, groupIndex) => {
      if (!Array.isArray(rows) || rows.length === 0) throw new TypeError(`frontier resident dedup group ${groupIndex} must be non-empty`);
      return normalizeRows(rows.map(row => ({ hash: 0, signature: `${groupIndex}\u0000${row?.signature}` })));
    });
    const residentRows = groups.flatMap((rows, groupIndex) => rows.map((row, index) => ({ groupId: groupIndex + 1, digestRef: row?.digestRef, digestIndex: row?.digestIndex, sourceIndex: groups.slice(0, groupIndex).reduce((sum, group) => sum + group.length, 0) + index, fingerprint: normalizedGroups[groupIndex][index].fingerprint })));
    const cpuKeeps = normalizedGroups.map(rows => Array.from(cpuDeduplicateFrontierStates(rows).keep)), flatExpected = cpuKeeps.flat(), candidateCount = residentRows.length;
    if (candidateCount > MAX_FRONTIER_DEDUP_ROWS) return Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: 'frontier-dedup-batch-capacity', keep: Object.freeze(cpuKeeps), candidateCount, groupCount: groups.length });
    const firstRef = residentRows[0]?.digestRef;
    const digestIndices = new Set(residentRows.map(row => row.digestIndex));
    if (!firstRef || firstRef.schema !== 'tdotdh.webgpu-resident-digest.v0' || firstRef.count < candidateCount || firstRef.strideWords !== 2 || digestIndices.size !== candidateCount || residentRows.some(row => !Number.isSafeInteger(row.digestIndex) || row.digestIndex < 0 || row.digestIndex >= firstRef.count || !row.digestRef || row.digestRef.buffer !== firstRef.buffer || row.digestRef.device !== firstRef.device || row.digestRef.generation !== firstRef.generation)) {
      return Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: 'resident-digest-layout-unavailable', keep: Object.freeze(cpuKeeps), candidateCount, groupCount: groups.length });
    }
    const status = await availability();
    if (status.status !== 'available') return Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: status.reason, keep: Object.freeze(cpuKeeps), candidateCount, groupCount: groups.length });
    try {
      if (!persistentRunner) persistentRunner = createPersistentGpuDedupRunner(await deviceCache.getDevice(), shaderSource);
      const gpuKeep = await persistentRunner.runResident(residentRows, firstRef);
      const mismatchIndex = gpuKeep.findIndex((value, index) => value !== flatExpected[index]);
      if (mismatchIndex >= 0) return Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: `oracle-parity-mismatch:${mismatchIndex}:${gpuKeep[mismatchIndex]}!=${flatExpected[mismatchIndex]}`, keep: Object.freeze(cpuKeeps), candidateCount, groupCount: groups.length });
      let offset = 0; const keep = cpuKeeps.map(group => { const result = Object.freeze(gpuKeep.slice(offset, offset + group.length)); offset += group.length; return result; });
      return Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'completed', backend: 'webgpu', parity: 'verified', algorithm: 'resident-digest-open-addressing-fingerprint-min', resident: true, keep: Object.freeze(keep), candidateCount, groupCount: groups.length });
    } catch (error) {
      persistentRunner?.reset(); persistentRunner = null; deviceCache.reset();
      return Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: `webgpu-execution-failed:${error?.message || String(error)}`, keep: Object.freeze(cpuKeeps), candidateCount, groupCount: groups.length });
    }
  };
  return Object.freeze({
    availability,
    async deduplicate(rows) {
      const normalized = normalizeRows(rows), cpu = cpuDeduplicateFrontierStates(normalized), result = await deduplicateMany([normalized]);
      if (result.status !== 'completed') return unavailable(result.reason, cpu);
      return Object.freeze({ ...cpu, status: 'completed', backend: 'webgpu', parity: 'verified', algorithm: result.algorithm });
    },
    deduplicateMany,
    deduplicateResidentMany,
  });
}
