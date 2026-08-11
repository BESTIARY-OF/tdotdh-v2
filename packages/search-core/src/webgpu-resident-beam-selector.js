import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_RESIDENT_BEAM_SELECTOR_SCHEMA = 'tdotdh.webgpu-resident-beam-selector.v0';
export const MAX_RESIDENT_BEAM_ROWS = 65536;
export const RESIDENT_BEAM_WORKGROUP_SIZE = 64;

const PAD_SCORE = 3.402823466e+38;
const SCORE_SHADER = `
struct Input { score: f32, tie: u32, };
struct Row { score: f32, tie: u32, index: u32, reserved: u32, };
struct Params { rowCount: u32, paddedCount: u32, reserved0: u32, reserved1: u32, };
@group(0) @binding(0) var<storage, read> inputs: array<Input>;
@group(0) @binding(1) var<storage, read_write> rows: array<Row>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(${RESIDENT_BEAM_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.paddedCount) { return; }
  if (id.x < params.rowCount) {
    let input = inputs[id.x];
    rows[id.x] = Row(input.score, input.tie, id.x, 0u);
  } else {
    rows[id.x] = Row(${PAD_SCORE}, 0xffffffffu, id.x, 0u);
  }
}`;

const SORT_SHADER = `
struct Row { score: f32, tie: u32, index: u32, reserved: u32, };
struct Params { rowCount: u32, paddedCount: u32, j: u32, k: u32, };
@group(0) @binding(0) var<storage, read> inputRows: array<Row>;
@group(0) @binding(1) var<storage, read_write> outputRows: array<Row>;
@group(0) @binding(2) var<uniform> params: Params;

fn isAfter(left: Row, right: Row) -> bool {
  return left.score > right.score || (left.score == right.score && (left.tie > right.tie || (left.tie == right.tie && left.index > right.index)));
}

@compute @workgroup_size(${RESIDENT_BEAM_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.paddedCount) { return; }
  let partner = id.x ^ params.j;
  let left = inputRows[id.x];
  let right = inputRows[partner];
  let ascending = (id.x & params.k) == 0u;
  let lower = (id.x & params.j) == 0u;
  let takeRight = ((ascending == lower) && isAfter(left, right)) || ((ascending != lower) && isAfter(right, left));
  if (takeRight) { outputRows[id.x] = right; } else { outputRows[id.x] = left; }
}`;

function normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_RESIDENT_BEAM_ROWS) throw new TypeError(`resident beam rows must contain 1-${MAX_RESIDENT_BEAM_ROWS} rows`);
  return rows.map((row, index) => {
    const score = Number(row?.score), tie = Number(row?.tie ?? index);
    if (!Number.isFinite(score)) throw new TypeError(`resident beam row ${index}.score must be finite`);
    if (!Number.isSafeInteger(tie) || tie < 0 || tie > 0xffffffff) throw new TypeError(`resident beam row ${index}.tie must be a non-negative uint32`);
    return Object.freeze({ score, tie });
  });
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

export function cpuSelectResidentBeam(rows, retain) {
  const normalized = normalizeRows(rows), limit = Math.min(Math.max(0, Number(retain) || 0), normalized.length);
  const indices = normalized.map((row, index) => index).sort((left, right) => normalized[left].score - normalized[right].score || normalized[left].tie - normalized[right].tie || left - right).slice(0, limit);
  return Object.freeze({ schema: WEBGPU_RESIDENT_BEAM_SELECTOR_SCHEMA, status: 'completed', backend: 'cpu-oracle', parity: 'oracle', algorithm: 'resident-score-rank', indices: Object.freeze(indices), rowCount: normalized.length, selectedCount: indices.length });
}

function unavailable(reason, rows, retain) {
  return Object.freeze({ ...cpuSelectResidentBeam(rows, retain), schema: WEBGPU_RESIDENT_BEAM_SELECTOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason), readback: 'cpu-fallback' });
}

function packRows(rows) {
  const packed = new ArrayBuffer(rows.length * 8), view = new DataView(packed);
  rows.forEach((row, index) => { view.setFloat32(index * 8, row.score, true); view.setUint32(index * 8 + 4, row.tie, true); });
  return packed;
}

async function runGpu(device, rows, retain, signal, isCancelled) {
  const paddedCount = nextPowerOfTwo(rows.length), rowBytes = paddedCount * 16, inputBytes = rows.length * 8;
  const inputs = device.createBuffer({ size: Math.max(8, inputBytes), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const rowsA = device.createBuffer({ size: rowBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const rowsB = device.createBuffer({ size: rowBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const readback = device.createBuffer({ size: Math.max(1, retain) * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const checkCancelled = () => { if (signal?.aborted || isCancelled?.()) { const error = new Error('resident beam selection cancelled'); error.name = 'AbortError'; throw error; } };
  try {
    checkCancelled();
    device.queue.writeBuffer(inputs, 0, packRows(rows));
    device.queue.writeBuffer(params, 0, new Uint32Array([rows.length, paddedCount, 0, 0]));
    const scoreModule = device.createShaderModule({ code: SCORE_SHADER }), scorePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: scoreModule, entryPoint: 'main' } });
    let encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(scorePipeline); pass.setBindGroup(0, device.createBindGroup({ layout: scorePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inputs } }, { binding: 1, resource: { buffer: rowsA } }, { binding: 2, resource: { buffer: params } }] })); pass.dispatchWorkgroups(Math.ceil(paddedCount / RESIDENT_BEAM_WORKGROUP_SIZE)); pass.end(); device.queue.submit([encoder.finish()]);
    const sortModule = device.createShaderModule({ code: SORT_SHADER }), sortPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: sortModule, entryPoint: 'main' } });
    let source = rowsA, destination = rowsB;
    for (let k = 2; k <= paddedCount; k *= 2) for (let j = k / 2; j >= 1; j /= 2) {
      checkCancelled();
      device.queue.writeBuffer(params, 0, new Uint32Array([rows.length, paddedCount, j, k]));
      const bindGroup = device.createBindGroup({ layout: sortPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: source } }, { binding: 1, resource: { buffer: destination } }, { binding: 2, resource: { buffer: params } }] });
      encoder = device.createCommandEncoder(); pass = encoder.beginComputePass(); pass.setPipeline(sortPipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(paddedCount / RESIDENT_BEAM_WORKGROUP_SIZE)); pass.end(); device.queue.submit([encoder.finish()]); [source, destination] = [destination, source];
    }
    checkCancelled();
    encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(source, 0, readback, 0, Math.max(1, retain) * 16); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone(); checkCancelled(); await readback.mapAsync(GPUMapMode.READ); const view = new DataView(readback.getMappedRange()), indices = []; for (let index = 0; index < retain; index++) indices.push(view.getUint32(index * 16 + 8, true)); readback.unmap(); return indices;
  } finally { for (const buffer of [inputs, rowsA, rowsB, params, readback]) buffer.destroy(); }
}

export function createWebGpuResidentBeamSelector({ gpu = globalThis.navigator?.gpu, requiredLimits = { maxComputeWorkgroupSizeX: RESIDENT_BEAM_WORKGROUP_SIZE }, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  let availabilityPromise = null;
  const availability = async () => {
    if (!availabilityPromise) availabilityPromise = probeWebGpuCapabilities({ gpu, requiredLimits }).then(probe => probe.adapterAvailable && probe.requiredLimitsSatisfied ? Object.freeze({ schema: WEBGPU_RESIDENT_BEAM_SELECTOR_SCHEMA, status: 'available', backend: 'webgpu', algorithm: 'resident-score-rank', readback: 'selected-indices' }) : Object.freeze({ schema: WEBGPU_RESIDENT_BEAM_SELECTOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable' }));
    return availabilityPromise;
  };
  return Object.freeze({
    availability,
    async select(rows, retain, { signal, isCancelled } = {}) {
      const normalized = normalizeRows(rows), cpu = cpuSelectResidentBeam(normalized, retain), status = await availability();
      if (status.status !== 'available') return unavailable(status.reason, normalized, retain);
      try {
        const device = await deviceCache.getDevice(), paddedCount = nextPowerOfTwo(normalized.length), maxRows = Math.floor((Number(device.limits?.maxStorageBufferBindingSize) || 0) / 16);
        if (maxRows < paddedCount) return unavailable('resident-beam-storage-capacity', normalized, retain);
        const indices = await runGpu(device, normalized, cpu.selectedCount, signal, isCancelled), parity = JSON.stringify(indices) === JSON.stringify(cpu.indices);
        return parity ? Object.freeze({ ...cpu, status: 'completed', backend: 'webgpu', parity: 'verified', readback: 'selected-indices', algorithm: 'resident-score-rank' }) : unavailable('oracle-parity-mismatch', normalized, retain);
      } catch (error) { deviceCache.reset(); if (error?.name === 'AbortError') return Object.freeze({ ...cpu, status: 'cancelled', backend: 'webgpu', parity: 'deferred', reason: 'resident-beam-selection-cancelled' }); return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, normalized, retain); }
    },
  });
}

export { SCORE_SHADER as RESIDENT_BEAM_SCORE_SHADER, SORT_SHADER as RESIDENT_BEAM_SORT_SHADER };
