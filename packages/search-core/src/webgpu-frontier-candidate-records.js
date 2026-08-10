import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_FRONTIER_CANDIDATE_RECORDS_SCHEMA = 'tdotdh.webgpu-frontier-candidate-records.v0';
export const MAX_FRONTIER_CANDIDATE_RECORDS = 16384;
export const FRONTIER_CANDIDATE_RECORD_STRIDE = 5;
export const FRONTIER_CANDIDATE_RECORD_SHADER = `
struct Params { recordCount: u32, reserved0: u32, reserved1: u32, reserved2: u32 };
@group(0) @binding(0) var<storage, read> records: array<i32>;
@group(0) @binding(1) var<storage, read_write> keep: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.recordCount) { return; }
  var retained = true;
  let base = id.x * ${FRONTIER_CANDIDATE_RECORD_STRIDE}u;
  for (var previous: u32 = 0u; previous < id.x; previous++) {
    let prior = previous * ${FRONTIER_CANDIDATE_RECORD_STRIDE}u;
    if (records[prior] == records[base] && records[prior + 1u] == records[base + 1u] && records[prior + 2u] == records[base + 2u] && records[prior + 3u] == records[base + 3u]) { retained = false; break; }
  }
  keep[id.x] = select(0u, 1u, retained);
}`;
export const FRONTIER_CANDIDATE_RECORD_SCAN_SHADER = `
struct Params { recordCount: u32, groupCount: u32, reserved0: u32, reserved1: u32 };
@group(0) @binding(0) var<storage, read> keep: array<u32>;
@group(0) @binding(1) var<storage, read_write> prefixes: array<u32>;
@group(0) @binding(2) var<storage, read_write> groupTotals: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;
var<workgroup> scan: array<u32, 64>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>, @builtin(local_invocation_id) localId: vec3<u32>, @builtin(workgroup_id) groupId: vec3<u32>) {
  let lane = localId.x;
  let index = globalId.x;
  if (index < params.recordCount) { scan[lane] = keep[index]; }
  else { scan[lane] = 0u; }
  workgroupBarrier();
  var offset = 1u;
  for (; offset < 64u; offset = offset * 2u) {
    let source = (lane + 1u) * offset * 2u - 1u;
    if (source < 64u && source >= offset) { scan[source] = scan[source] + scan[source - offset]; }
    workgroupBarrier();
  }
  if (lane == 0u) { groupTotals[groupId.x] = scan[63]; scan[63] = 0u; }
  workgroupBarrier();
  var down = 32u;
  loop {
    let source = (lane + 1u) * down * 2u - 1u;
    if (source < 64u && source >= down) {
      let value = scan[source - down];
      scan[source - down] = scan[source];
      scan[source] = scan[source] + value;
    }
    workgroupBarrier();
    if (down == 1u) { break; }
    down = down / 2u;
  }
  if (index < params.recordCount) { prefixes[index] = scan[lane]; }
}`;
export const FRONTIER_CANDIDATE_RECORD_COMPACT_SHADER = `
struct Params { recordCount: u32, reserved0: u32, reserved1: u32, reserved2: u32 };
@group(0) @binding(0) var<storage, read> records: array<i32>;
@group(0) @binding(1) var<storage, read> keep: array<u32>;
@group(0) @binding(2) var<storage, read> prefixes: array<u32>;
@group(0) @binding(3) var<storage, read> groupOffsets: array<u32>;
@group(0) @binding(4) var<storage, read_write> outputRecords: array<i32>;
@group(0) @binding(5) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.recordCount || keep[id.x] == 0u) { return; }
  let outputIndex = groupOffsets[id.x / 64u] + prefixes[id.x];
  let sourceBase = id.x * ${FRONTIER_CANDIDATE_RECORD_STRIDE}u;
  let outputBase = outputIndex * ${FRONTIER_CANDIDATE_RECORD_STRIDE}u;
  for (var field = 0u; field < ${FRONTIER_CANDIDATE_RECORD_STRIDE}u; field = field + 1u) { outputRecords[outputBase + field] = records[sourceBase + field]; }
}`;

function uint(value, label, index) { if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new TypeError(`candidate record ${index}.${label} must be a uint32`); return value >>> 0; }
function sint(value, label, index) { if (!Number.isSafeInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new TypeError(`candidate record ${index}.${label} must be an int32`); return value | 0; }
function normalizeRecord(record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError(`candidate record ${index} must be an object`);
  const keys = Object.keys(record).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['inputOrdinal', 'originX', 'originY', 'pieceId', 'targetOrdinal'])) throw new TypeError(`candidate record ${index} has an invalid shape`);
  return Object.freeze({ pieceId: uint(record.pieceId, 'pieceId', index), targetOrdinal: uint(record.targetOrdinal, 'targetOrdinal', index), originX: sint(record.originX, 'originX', index), originY: sint(record.originY, 'originY', index), inputOrdinal: uint(record.inputOrdinal, 'inputOrdinal', index) });
}
function normalizeRecords(records, capacity = MAX_FRONTIER_CANDIDATE_RECORDS) {
  if (!Array.isArray(records) || records.length > capacity || records.length > MAX_FRONTIER_CANDIDATE_RECORDS) throw new RangeError(`candidate records must contain at most ${Math.min(capacity, MAX_FRONTIER_CANDIDATE_RECORDS)} records`);
  return records.map(normalizeRecord);
}
function recordKey(record) { return `${record.pieceId}:${record.targetOrdinal}:${record.originX}:${record.originY}`; }
function digest(records) { let hash = 2166136261; for (const record of records) for (const value of [record.pieceId, record.targetOrdinal, record.originX, record.originY, record.inputOrdinal]) hash = Math.imul(hash ^ (value >>> 0), 16777619) >>> 0; return `fnv1a32-${hash.toString(16).padStart(8, '0')}`; }

export function cpuCompactFrontierCandidateRecords(records, { capacity = MAX_FRONTIER_CANDIDATE_RECORDS } = {}) {
  const normalized = normalizeRecords(records, capacity), seen = new Set(), compacted = [];
  for (const record of normalized) { const key = recordKey(record); if (!seen.has(key)) { seen.add(key); compacted.push(record); } }
  return Object.freeze({ schema: WEBGPU_FRONTIER_CANDIDATE_RECORDS_SCHEMA, status: 'completed', backend: 'cpu-oracle', parity: 'oracle', inputCount: normalized.length, outputCount: compacted.length, inputDigest: digest(normalized), outputDigest: digest(compacted), records: Object.freeze(compacted) });
}

function flatten(records) { const values = new Int32Array(records.length * FRONTIER_CANDIDATE_RECORD_STRIDE); records.forEach((record, index) => { const base = index * FRONTIER_CANDIDATE_RECORD_STRIDE; values[base] = record.pieceId; values[base + 1] = record.targetOrdinal; values[base + 2] = record.originX; values[base + 3] = record.originY; values[base + 4] = record.inputOrdinal; }); return values; }
async function runGpu(device, records, shaderSource) {
  const groupCount = Math.ceil(records.length / 64), recordBytes = Math.max(4, records.length * FRONTIER_CANDIDATE_RECORD_STRIDE * 4), keepBytes = Math.max(4, records.length * 4), groupBytes = Math.max(4, groupCount * 4);
  const recordBuffer = device.createBuffer({ size: recordBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const keepBuffer = device.createBuffer({ size: keepBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const prefixBuffer = device.createBuffer({ size: keepBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const groupTotalsBuffer = device.createBuffer({ size: groupBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const groupOffsetsBuffer = device.createBuffer({ size: groupBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const outputBuffer = device.createBuffer({ size: recordBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const markParamsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const scanParamsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const compactParamsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const groupReadback = device.createBuffer({ size: groupBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const outputReadback = device.createBuffer({ size: recordBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(recordBuffer, 0, flatten(records));
    device.queue.writeBuffer(markParamsBuffer, 0, new Uint32Array([records.length, 0, 0, 0]));
    const markModule = device.createShaderModule({ code: shaderSource }), markPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: markModule, entryPoint: 'main' } });
    const markGroup = device.createBindGroup({ layout: markPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: recordBuffer } }, { binding: 1, resource: { buffer: keepBuffer } }, { binding: 2, resource: { buffer: markParamsBuffer } }] });
    const markEncoder = device.createCommandEncoder(), markPass = markEncoder.beginComputePass(); markPass.setPipeline(markPipeline); markPass.setBindGroup(0, markGroup); markPass.dispatchWorkgroups(Math.ceil(records.length / 64)); markPass.end(); device.queue.submit([markEncoder.finish()]);

    device.queue.writeBuffer(scanParamsBuffer, 0, new Uint32Array([records.length, groupCount, 0, 0]));
    const scanModule = device.createShaderModule({ code: FRONTIER_CANDIDATE_RECORD_SCAN_SHADER }), scanPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: scanModule, entryPoint: 'main' } });
    const scanGroup = device.createBindGroup({ layout: scanPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: keepBuffer } }, { binding: 1, resource: { buffer: prefixBuffer } }, { binding: 2, resource: { buffer: groupTotalsBuffer } }, { binding: 3, resource: { buffer: scanParamsBuffer } }] });
    const scanEncoder = device.createCommandEncoder(), scanPass = scanEncoder.beginComputePass(); scanPass.setPipeline(scanPipeline); scanPass.setBindGroup(0, scanGroup); scanPass.dispatchWorkgroups(groupCount); scanPass.end(); scanEncoder.copyBufferToBuffer(groupTotalsBuffer, 0, groupReadback, 0, groupBytes); device.queue.submit([scanEncoder.finish()]); await device.queue.onSubmittedWorkDone();
    await groupReadback.mapAsync(GPUMapMode.READ); const groupTotals = Array.from(new Uint32Array(groupReadback.getMappedRange().slice(0, groupBytes))); groupReadback.unmap();
    const groupOffsets = new Uint32Array(groupCount); let outputCount = 0; for (let index = 0; index < groupTotals.length; index++) { groupOffsets[index] = outputCount; outputCount += groupTotals[index]; }
    device.queue.writeBuffer(groupOffsetsBuffer, 0, groupOffsets); device.queue.writeBuffer(compactParamsBuffer, 0, new Uint32Array([records.length, 0, 0, 0]));
    const compactModule = device.createShaderModule({ code: FRONTIER_CANDIDATE_RECORD_COMPACT_SHADER }), compactPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: compactModule, entryPoint: 'main' } });
    const compactGroup = device.createBindGroup({ layout: compactPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: recordBuffer } }, { binding: 1, resource: { buffer: keepBuffer } }, { binding: 2, resource: { buffer: prefixBuffer } }, { binding: 3, resource: { buffer: groupOffsetsBuffer } }, { binding: 4, resource: { buffer: outputBuffer } }, { binding: 5, resource: { buffer: compactParamsBuffer } }] });
    const compactEncoder = device.createCommandEncoder(), compactPass = compactEncoder.beginComputePass(); compactPass.setPipeline(compactPipeline); compactPass.setBindGroup(0, compactGroup); compactPass.dispatchWorkgroups(Math.ceil(records.length / 64)); compactPass.end(); compactEncoder.copyBufferToBuffer(outputBuffer, 0, outputReadback, 0, Math.max(4, outputCount * FRONTIER_CANDIDATE_RECORD_STRIDE * 4)); device.queue.submit([compactEncoder.finish()]); await device.queue.onSubmittedWorkDone();
    const compacted = []; if (outputCount) { await outputReadback.mapAsync(GPUMapMode.READ); const values = new Int32Array(outputReadback.getMappedRange().slice(0, outputCount * FRONTIER_CANDIDATE_RECORD_STRIDE * 4)); outputReadback.unmap(); for (let index = 0; index < outputCount; index++) { const base = index * FRONTIER_CANDIDATE_RECORD_STRIDE; compacted.push({ pieceId: values[base] >>> 0, targetOrdinal: values[base + 1] >>> 0, originX: values[base + 2], originY: values[base + 3], inputOrdinal: values[base + 4] >>> 0 }); } }
    return compacted;
  } finally { for (const buffer of [recordBuffer, keepBuffer, prefixBuffer, groupTotalsBuffer, groupOffsetsBuffer, outputBuffer, markParamsBuffer, scanParamsBuffer, compactParamsBuffer, groupReadback, outputReadback]) buffer.destroy(); }
}
function unavailable(reason, cpu) { return Object.freeze({ ...cpu, schema: WEBGPU_FRONTIER_CANDIDATE_RECORDS_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason) }); }

export function createWebGpuFrontierCandidateRecords({ gpu = globalThis.navigator?.gpu, requiredLimits = { maxComputeWorkgroupSizeX: 64 }, shaderSource = FRONTIER_CANDIDATE_RECORD_SHADER, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  let availabilityPromise = null;
  const availability = async () => { if (!availabilityPromise) availabilityPromise = probeWebGpuCapabilities({ gpu, requiredLimits }).then(probe => probe.adapterAvailable && probe.requiredLimitsSatisfied ? Object.freeze({ schema: WEBGPU_FRONTIER_CANDIDATE_RECORDS_SCHEMA, status: 'available', backend: 'webgpu' }) : Object.freeze({ schema: WEBGPU_FRONTIER_CANDIDATE_RECORDS_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable' })); return availabilityPromise; };
  return Object.freeze({
    availability,
    async compact(records) {
      const normalized = normalizeRecords(records), cpu = cpuCompactFrontierCandidateRecords(normalized), status = await availability();
      if (status.status !== 'available') return unavailable(status.reason, cpu);
      try {
        const gpuRecords = await runGpu(await deviceCache.getDevice(), normalized, shaderSource);
        if (JSON.stringify(gpuRecords) !== JSON.stringify(cpu.records)) return unavailable('oracle-parity-mismatch', cpu);
        return Object.freeze({ ...cpu, status: 'completed', backend: 'webgpu', parity: 'verified', compaction: 'gpu-stable-prefix-scan', records: Object.freeze(gpuRecords) });
      } catch (error) { deviceCache.reset(); return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, cpu); }
    },
  });
}
