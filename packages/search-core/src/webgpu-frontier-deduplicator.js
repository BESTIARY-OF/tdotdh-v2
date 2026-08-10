import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA = 'tdotdh.webgpu-frontier-deduplicator.v0';
export const MAX_FRONTIER_DEDUP_ROWS = 4096;
export const FRONTIER_DEDUP_WORKGROUP_SIZE = 64;

export const DEFAULT_SHADER = `
struct Params { rowCount: u32, reserved0: u32, reserved1: u32, reserved2: u32, };
@group(0) @binding(0) var<storage, read> hashes: array<u32>;
@group(0) @binding(1) var<storage, read_write> keep: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(${FRONTIER_DEDUP_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.rowCount) { return; }
  var retained = true;
  for (var previous = 0u; previous < index; previous++) {
    if (hashes[previous] == hashes[index]) { retained = false; break; }
  }
  keep[index] = select(0u, 1u, retained);
}`;

function normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_FRONTIER_DEDUP_ROWS) throw new TypeError(`frontier dedup rows must contain 1-${MAX_FRONTIER_DEDUP_ROWS} rows`);
  return rows.map((row, index) => {
    const hash = Number(row?.hash), signature = row?.signature;
    if (!Number.isSafeInteger(hash) || hash < 0 || hash > 0xffffffff) throw new TypeError(`frontier dedup row ${index}.hash must be a uint32`);
    if (typeof signature !== 'string' || !signature) throw new TypeError(`frontier dedup row ${index}.signature must be a non-empty string`);
    return Object.freeze({ hash: hash >>> 0, signature });
  });
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
  const bytes = Math.max(4, rows.length * 4);
  const hashes = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const keep = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const readback = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(hashes, 0, Uint32Array.from(rows, row => row.hash));
    device.queue.writeBuffer(params, 0, new Uint32Array([rows.length, 0, 0, 0]));
    const module = device.createShaderModule({ code: shaderSource });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: hashes } }, { binding: 1, resource: { buffer: keep } }, { binding: 2, resource: { buffer: params } }] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(rows.length / FRONTIER_DEDUP_WORKGROUP_SIZE)); pass.end();
    encoder.copyBufferToBuffer(keep, 0, readback, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await readback.mapAsync(GPUMapMode.READ);
    const result = Array.from(new Uint32Array(readback.getMappedRange().slice(0, rows.length * 4)));
    readback.unmap();
    return result;
  } finally {
    for (const buffer of [hashes, keep, params, readback]) buffer.destroy();
  }
}

export function createWebGpuFrontierDeduplicator({ gpu = globalThis.navigator?.gpu, requiredLimits = { maxComputeWorkgroupSizeX: FRONTIER_DEDUP_WORKGROUP_SIZE }, shaderSource = DEFAULT_SHADER, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  let availabilityPromise = null;
  const availability = async () => {
    if (!availabilityPromise) availabilityPromise = probeWebGpuCapabilities({ gpu, requiredLimits }).then(probe => probe.adapterAvailable && probe.requiredLimitsSatisfied
      ? Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'available', backend: 'webgpu' })
      : Object.freeze({ schema: WEBGPU_FRONTIER_DEDUPLICATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable' }));
    return availabilityPromise;
  };
  return Object.freeze({
    availability,
    async deduplicate(rows) {
      const normalized = normalizeRows(rows), cpu = cpuDeduplicateFrontierStates(normalized), status = await availability();
      if (status.status !== 'available') return unavailable(status.reason, cpu);
      try {
        const gpuKeep = await runGpu(await deviceCache.getDevice(), normalized, shaderSource);
        if (JSON.stringify(gpuKeep) !== JSON.stringify(cpu.keep)) return unavailable('oracle-parity-mismatch', cpu);
        return Object.freeze({ ...cpu, status: 'completed', backend: 'webgpu', parity: 'verified' });
      } catch (error) {
        deviceCache.reset();
        return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, cpu);
      }
    },
  });
}
