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
  const recordBytes = Math.max(4, records.length * FRONTIER_CANDIDATE_RECORD_STRIDE * 4), keepBytes = Math.max(4, records.length * 4);
  const recordBuffer = device.createBuffer({ size: recordBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const keepBuffer = device.createBuffer({ size: keepBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const paramsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const readback = device.createBuffer({ size: keepBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(recordBuffer, 0, flatten(records)); device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([records.length, 0, 0, 0]));
    const module = device.createShaderModule({ code: shaderSource }), pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } }), bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: recordBuffer } }, { binding: 1, resource: { buffer: keepBuffer } }, { binding: 2, resource: { buffer: paramsBuffer } }] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(records.length / 64)); pass.end(); encoder.copyBufferToBuffer(keepBuffer, 0, readback, 0, keepBytes); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone(); await readback.mapAsync(GPUMapMode.READ); const keep = Array.from(new Uint32Array(readback.getMappedRange().slice(0, keepBytes))); readback.unmap(); return keep;
  } finally { for (const buffer of [recordBuffer, keepBuffer, paramsBuffer, readback]) buffer.destroy(); }
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
        const keep = await runGpu(await deviceCache.getDevice(), normalized, shaderSource), gpuRecords = normalized.filter((_, index) => keep[index] === 1);
        if (JSON.stringify(gpuRecords) !== JSON.stringify(cpu.records)) return unavailable('oracle-parity-mismatch', cpu);
        return Object.freeze({ ...cpu, status: 'completed', backend: 'webgpu', parity: 'verified', records: Object.freeze(gpuRecords) });
      } catch (error) { deviceCache.reset(); return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, cpu); }
    },
  });
}

