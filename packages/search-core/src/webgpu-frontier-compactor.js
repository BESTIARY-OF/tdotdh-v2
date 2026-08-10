import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_FRONTIER_COMPACTOR_SCHEMA = 'tdotdh.webgpu-frontier-compactor.v0';
export const MAX_FRONTIER_COMPACTOR_ROWS = 65536;
export const FRONTIER_COMPACTOR_WORKGROUP_SIZE = 64;
const PAD_SCORE = 3.402823466e+38;
const SHADER = `
struct Row { score: f32, tie: u32, index: u32, reserved: u32, };
struct Params { paddedCount: u32, rowCount: u32, j: u32, k: u32, };
@group(0) @binding(0) var<storage, read> inputRows: array<Row>;
@group(0) @binding(1) var<storage, read_write> outputRows: array<Row>;
@group(0) @binding(2) var<uniform> params: Params;

fn isAfter(left: Row, right: Row) -> bool {
  return left.score > right.score || (left.score == right.score && (left.tie > right.tie || (left.tie == right.tie && left.index > right.index)));
}

@compute @workgroup_size(${FRONTIER_COMPACTOR_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.paddedCount) { return; }
  let partner = index ^ params.j;
  let left = inputRows[index];
  let right = inputRows[partner];
  let ascending = (index & params.k) == 0u;
  let lower = (index & params.j) == 0u;
  let takeRight = ((ascending == lower) && isAfter(left, right)) || ((ascending != lower) && isAfter(right, left));
  if (takeRight) { outputRows[index] = right; }
  else { outputRows[index] = left; }
}`;

function normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_FRONTIER_COMPACTOR_ROWS) throw new TypeError(`frontier compactor rows must contain 1-${MAX_FRONTIER_COMPACTOR_ROWS} rows`);
  return rows.map((row, index) => ({ score: Number(row?.score), tie: Number(row?.tie ?? index), index })).map((row, index) => {
    if (!Number.isFinite(row.score)) throw new TypeError(`frontier compactor row ${index}.score must be finite`);
    if (!Number.isSafeInteger(row.tie) || row.tie < 0) throw new TypeError(`frontier compactor row ${index}.tie must be a non-negative safe integer`);
    return row;
  });
}

function normalizeRetain(retain, rowCount) {
  if (!Number.isSafeInteger(Number(retain)) || Number(retain) < 0) throw new TypeError('frontier compactor retain must be a non-negative safe integer');
  return Math.min(Number(retain), rowCount);
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function makeResult(status, backend, parity, rows, indices, extra = {}) {
  const keep = new Array(rows.length).fill(0);
  indices.forEach(index => { keep[index] = 1; });
  return Object.freeze({ schema: WEBGPU_FRONTIER_COMPACTOR_SCHEMA, status, backend, parity, indices: Object.freeze(indices), keep: Object.freeze(keep), rowCount: rows.length, selectedCount: indices.length, ...extra });
}

export function cpuCompactFrontierRows(rows, retain) {
  const normalized = normalizeRows(rows), limit = normalizeRetain(retain, normalized.length), indices = normalized.map(row => row.index).sort((left, right) => normalized[left].score - normalized[right].score || normalized[left].tie - normalized[right].tie || left - right).slice(0, limit);
  return makeResult('completed', 'cpu-oracle', 'oracle', normalized, indices);
}

function packRows(rows, paddedCount) {
  const packed = new ArrayBuffer(paddedCount * 16), view = new DataView(packed);
  rows.forEach((row, index) => { view.setFloat32(index * 16, row.score, true); view.setUint32(index * 16 + 4, row.tie, true); view.setUint32(index * 16 + 8, index, true); });
  for (let index = rows.length; index < paddedCount; index++) { view.setFloat32(index * 16, PAD_SCORE, true); view.setUint32(index * 16 + 4, 0xffffffff, true); view.setUint32(index * 16 + 8, index, true); }
  return packed;
}

async function runGpu(device, rows, retain, shaderSource) {
  const paddedCount = nextPowerOfTwo(rows.length), bytes = paddedCount * 16, readbackBytes = Math.max(1, retain) * 16, initial = packRows(rows, paddedCount);
  const input = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }), output = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }), params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), readback = device.createBuffer({ size: readbackBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(input, 0, initial);
    const module = device.createShaderModule({ code: shaderSource }), pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    let source = input, destination = output;
    for (let k = 2; k <= paddedCount; k *= 2) for (let j = k / 2; j >= 1; j /= 2) {
      device.queue.writeBuffer(params, 0, new Uint32Array([paddedCount, rows.length, j, k]));
      const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: source } }, { binding: 1, resource: { buffer: destination } }, { binding: 2, resource: { buffer: params } }] });
      const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(paddedCount / FRONTIER_COMPACTOR_WORKGROUP_SIZE)); pass.end(); device.queue.submit([encoder.finish()]); [source, destination] = [destination, source];
    }
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(source, 0, readback, 0, readbackBytes); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone(); await readback.mapAsync(GPUMapMode.READ);
    const view = new DataView(readback.getMappedRange()), indices = []; for (let index = 0; index < retain; index++) indices.push(view.getUint32(index * 16 + 8, true)); readback.unmap(); return indices;
  } finally { for (const buffer of [input, output, params, readback]) buffer.destroy(); }
}

function createPersistentResources(device, capacity, shaderSource) {
  const paddedCapacity = nextPowerOfTwo(capacity), bytes = paddedCapacity * 16;
  const input = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  const output = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const readback = device.createBuffer({ size: Math.max(1, capacity) * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const module = device.createShaderModule({ code: shaderSource });
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  return { capacity, paddedCapacity, input, output, params, readback, pipeline };
}

function destroyPersistentResources(resources) {
  if (!resources) return;
  for (const buffer of [resources.input, resources.output, resources.params, resources.readback]) buffer.destroy();
}

async function runGpuPersistent(device, resources, rows, retain) {
  device.queue.writeBuffer(resources.input, 0, packRows(rows, resources.paddedCapacity));
  let source = resources.input, destination = resources.output;
  for (let k = 2; k <= resources.paddedCapacity; k *= 2) for (let j = k / 2; j >= 1; j /= 2) {
    device.queue.writeBuffer(resources.params, 0, new Uint32Array([resources.paddedCapacity, rows.length, j, k]));
    const bindGroup = device.createBindGroup({ layout: resources.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: source } }, { binding: 1, resource: { buffer: destination } }, { binding: 2, resource: { buffer: resources.params } }] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(resources.pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(resources.paddedCapacity / FRONTIER_COMPACTOR_WORKGROUP_SIZE)); pass.end(); device.queue.submit([encoder.finish()]); [source, destination] = [destination, source];
  }
  const readbackBytes = Math.max(1, retain) * 16, encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, resources.readback, 0, readbackBytes);
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await resources.readback.mapAsync(GPUMapMode.READ);
  const view = new DataView(resources.readback.getMappedRange()), indices = [];
  for (let index = 0; index < retain; index++) indices.push(view.getUint32(index * 16 + 8, true));
  resources.readback.unmap();
  return indices;
}

export function createWebGpuFrontierCompactor({ gpu = globalThis.navigator?.gpu, requiredLimits = { maxComputeWorkgroupSizeX: FRONTIER_COMPACTOR_WORKGROUP_SIZE }, shaderSource = SHADER, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  const limits = { ...requiredLimits }; let availabilityPromise = null;
  const availability = async () => {
    if (!availabilityPromise) availabilityPromise = probeWebGpuCapabilities({ gpu, requiredLimits: limits }).then(probe => probe.adapterAvailable && probe.requiredLimitsSatisfied ? Object.freeze({ schema: WEBGPU_FRONTIER_COMPACTOR_SCHEMA, status: 'available', backend: 'webgpu', algorithm: 'multi-pass-bitonic-top-k' }) : Object.freeze({ schema: WEBGPU_FRONTIER_COMPACTOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable' }));
    return availabilityPromise;
  };
  return Object.freeze({
    availability,
    async compact(rows, retain) {
      const normalized = normalizeRows(rows), limit = normalizeRetain(retain, normalized.length), cpu = cpuCompactFrontierRows(normalized, limit), status = await availability();
      if (status.status !== 'available') return makeResult('unavailable', 'webgpu', 'oracle', normalized, cpu.indices, { reason: status.reason });
      try {
        const device = await deviceCache.getDevice(), maxRows = Math.floor((Number(device.limits?.maxStorageBufferBindingSize) || 0) / 16);
        if (maxRows < nextPowerOfTwo(normalized.length)) return makeResult('unavailable', 'webgpu', 'oracle', normalized, cpu.indices, { reason: 'frontier-compactor-storage-capacity' });
        const indices = await runGpu(device, normalized, limit, shaderSource), parity = JSON.stringify(indices) === JSON.stringify(cpu.indices);
        return parity ? makeResult('completed', 'webgpu', 'verified', normalized, indices, { algorithm: 'multi-pass-bitonic-top-k' }) : makeResult('unavailable', 'webgpu', 'oracle', normalized, cpu.indices, { reason: 'oracle-parity-mismatch' });
      } catch (error) { deviceCache.reset(); return makeResult('unavailable', 'webgpu', 'oracle', normalized, cpu.indices, { reason: `webgpu-execution-failed:${error?.message || String(error)}` }); }
    },
  });
}

export function createWebGpuPersistentFrontierCompactor({ gpu = globalThis.navigator?.gpu, capacity = MAX_FRONTIER_COMPACTOR_ROWS, requiredLimits = { maxComputeWorkgroupSizeX: FRONTIER_COMPACTOR_WORKGROUP_SIZE }, shaderSource = SHADER, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_FRONTIER_COMPACTOR_ROWS) throw new TypeError(`persistent frontier compactor capacity must be 1-${MAX_FRONTIER_COMPACTOR_ROWS}`);
  const limits = { ...requiredLimits }; let availabilityPromise = null, resources = null;
  const availability = async () => {
    if (!availabilityPromise) availabilityPromise = probeWebGpuCapabilities({ gpu, requiredLimits: limits }).then(probe => probe.adapterAvailable && probe.requiredLimitsSatisfied ? Object.freeze({ schema: WEBGPU_FRONTIER_COMPACTOR_SCHEMA, status: 'available', backend: 'webgpu', algorithm: 'persistent-multi-pass-bitonic-top-k', capacity }) : Object.freeze({ schema: WEBGPU_FRONTIER_COMPACTOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable', capacity }));
    return availabilityPromise;
  };
  const reset = () => { destroyPersistentResources(resources); resources = null; deviceCache.reset(); };
  return Object.freeze({
    availability,
    reset,
    async compact(rows, retain) {
      const normalized = normalizeRows(rows), limit = normalizeRetain(retain, normalized.length), cpu = cpuCompactFrontierRows(normalized, limit), status = await availability(), paddedCount = nextPowerOfTwo(normalized.length);
      if (normalized.length > capacity || paddedCount > nextPowerOfTwo(capacity)) return makeResult('unavailable', 'webgpu', 'oracle', normalized, cpu.indices, { reason: 'persistent-frontier-capacity', persistent: true, bufferCapacity: capacity });
      if (status.status !== 'available') return makeResult('unavailable', 'webgpu', 'oracle', normalized, cpu.indices, { reason: status.reason, persistent: true, bufferCapacity: capacity });
      try {
        const device = await deviceCache.getDevice(), maxStorageRows = Math.floor((Number(device.limits?.maxStorageBufferBindingSize) || 0) / 16), maxBufferRows = Math.floor((Number(device.limits?.maxBufferSize) || 0) / 16);
        if (maxStorageRows < nextPowerOfTwo(capacity) || (maxBufferRows > 0 && maxBufferRows < nextPowerOfTwo(capacity))) return makeResult('unavailable', 'webgpu', 'oracle', normalized, cpu.indices, { reason: 'persistent-frontier-storage-capacity', persistent: true, bufferCapacity: capacity });
        if (!resources) resources = createPersistentResources(device, capacity, shaderSource);
        const indices = await runGpuPersistent(device, resources, normalized, limit), parity = JSON.stringify(indices) === JSON.stringify(cpu.indices);
        return parity ? makeResult('completed', 'webgpu', 'verified', normalized, indices, { algorithm: 'persistent-multi-pass-bitonic-top-k', persistent: true, bufferCapacity: capacity }) : makeResult('unavailable', 'webgpu', 'oracle', normalized, cpu.indices, { reason: 'oracle-parity-mismatch', persistent: true, bufferCapacity: capacity });
      } catch (error) { reset(); return makeResult('unavailable', 'webgpu', 'oracle', normalized, cpu.indices, { reason: `webgpu-execution-failed:${error?.message || String(error)}`, persistent: true, bufferCapacity: capacity }); }
    },
  });
}

export { SHADER as DEFAULT_SHADER };
