import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_FRONTIER_RANKER_SCHEMA = 'tdotdh.webgpu-frontier-ranker.v0';
export const MAX_FRONTIER_RANK_ROWS = 65536;
export const FRONTIER_RANK_WORKGROUP_SIZE = 64;
const PAD_SCORE = 3.402823466e+38;
const SHADER = `
struct Row { score: f32, tie: u32, index: u32, reserved: u32, };
struct Params { paddedCount: u32, segmentCount: u32, j: u32, k: u32, };
@group(0) @binding(0) var<storage, read> inputRows: array<Row>;
@group(0) @binding(1) var<storage, read_write> outputRows: array<Row>;
@group(0) @binding(2) var<uniform> params: Params;

fn isAfter(left: Row, right: Row) -> bool {
  return left.score > right.score || (left.score == right.score && (left.tie > right.tie || (left.tie == right.tie && left.index > right.index)));
}

@compute @workgroup_size(${FRONTIER_RANK_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  let segment = index / params.paddedCount;
  let local = index % params.paddedCount;
  if (segment >= params.segmentCount) { return; }
  let partner = segment * params.paddedCount + (local ^ params.j);
  let left = inputRows[index];
  let right = inputRows[partner];
  let ascending = (local & params.k) == 0u;
  let lower = (local & params.j) == 0u;
  let takeRight = ((ascending == lower) && isAfter(left, right)) || ((ascending != lower) && isAfter(right, left));
  if (takeRight) { outputRows[index] = right; }
  else { outputRows[index] = left; }
}`;

function normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_FRONTIER_RANK_ROWS) throw new TypeError(`frontier rank rows must contain 1-${MAX_FRONTIER_RANK_ROWS} rows`);
  return rows.map((row, index) => Object.freeze({ score: Number(row?.score), tie: Number(row?.tie ?? index), index })).map((row, index) => {
    if (!Number.isFinite(row.score)) throw new TypeError(`frontier rank row ${index}.score must be finite`);
    if (!Number.isSafeInteger(row.tie) || row.tie < 0) throw new TypeError(`frontier rank row ${index}.tie must be a non-negative safe integer`);
    return row;
  });
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

export function cpuRankFrontierRows(rows) {
  const normalized = normalizeRows(rows), indices = normalized.map(row => row.index).sort((left, right) => normalized[left].score - normalized[right].score || normalized[left].tie - normalized[right].tie || left - right);
  return Object.freeze({ schema: WEBGPU_FRONTIER_RANKER_SCHEMA, status: 'completed', backend: 'cpu-oracle', parity: 'oracle', indices: Object.freeze(indices), rowCount: normalized.length });
}

function packRowsBatches(batches, paddedCount) {
  const packed = new ArrayBuffer(batches.length * paddedCount * 16), view = new DataView(packed);
  batches.forEach((rows, segment) => {
    rows.forEach((row, index) => { const offset = (segment * paddedCount + index) * 16; view.setFloat32(offset, row.score, true); view.setUint32(offset + 4, row.tie, true); view.setUint32(offset + 8, index, true); });
    for (let index = rows.length; index < paddedCount; index += 1) { const offset = (segment * paddedCount + index) * 16; view.setFloat32(offset, PAD_SCORE, true); view.setUint32(offset + 4, 0xffffffff, true); view.setUint32(offset + 8, index, true); }
  });
  return packed;
}

async function runGpuMany(device, batches, pipeline, bindGroupLayout, paddedCount) {
  const segmentCount = batches.length, bytes = segmentCount * paddedCount * 16, initial = packRowsBatches(batches, paddedCount);
  const input = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }), output = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }), readback = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), paramsBuffers = [];
  try {
    device.queue.writeBuffer(input, 0, initial);
    const encoder = device.createCommandEncoder(); let source = input, destination = output;
    for (let k = 2; k <= paddedCount; k *= 2) for (let j = k / 2; j >= 1; j /= 2) {
      const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); paramsBuffers.push(params); device.queue.writeBuffer(params, 0, new Uint32Array([paddedCount, segmentCount, j, k]));
      const bindGroup = device.createBindGroup({ layout: bindGroupLayout, entries: [{ binding: 0, resource: { buffer: source } }, { binding: 1, resource: { buffer: destination } }, { binding: 2, resource: { buffer: params } }] });
      const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil((paddedCount * segmentCount) / FRONTIER_RANK_WORKGROUP_SIZE)); pass.end(); [source, destination] = [destination, source];
    }
    encoder.copyBufferToBuffer(source, 0, readback, 0, bytes); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone(); await readback.mapAsync(GPUMapMode.READ);
    const view = new DataView(readback.getMappedRange()), indices = batches.map((rows, segment) => rows.map((row, index) => view.getUint32((segment * paddedCount + index) * 16 + 8, true))); readback.unmap(); return indices;
  } finally { for (const buffer of [input, output, readback, ...paramsBuffers]) buffer.destroy(); }
}

export function createWebGpuFrontierRanker({ gpu = globalThis.navigator?.gpu, requiredLimits = { maxComputeWorkgroupSizeX: FRONTIER_RANK_WORKGROUP_SIZE }, shaderSource = SHADER, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  const limits = { ...requiredLimits }; let availabilityPromise = null, pipelineDevice = null, pipeline = null, bindGroupLayout = null;
  const fallback = (reason, rows, diagnostics = null) => Object.freeze({ ...cpuRankFrontierRows(rows), schema: WEBGPU_FRONTIER_RANKER_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason), ...(diagnostics ? { diagnostics } : {}) });
  const fallbackMany = (reason, batches) => batches.map(rows => fallback(reason, rows));
  const availability = async () => {
    if (!availabilityPromise) availabilityPromise = probeWebGpuCapabilities({ gpu, requiredLimits: limits }).then(probe => probe.adapterAvailable && probe.requiredLimitsSatisfied ? Object.freeze({ schema: WEBGPU_FRONTIER_RANKER_SCHEMA, status: 'available', backend: 'webgpu', algorithm: 'multi-pass-bitonic-sort' }) : fallback(probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable', [{ score: 0 }]));
    return availabilityPromise;
  };
  const rankMany = async batches => {
    if (!Array.isArray(batches) || batches.length === 0 || batches.some(rows => !Array.isArray(rows) || rows.length === 0)) throw new TypeError('frontier rank batches must contain non-empty row arrays');
    const normalizedBatches = batches.map(normalizeRows), status = await availability();
    if (status.status !== 'available') return fallbackMany(status.reason || 'webgpu-unavailable', normalizedBatches);
    try {
      const device = await deviceCache.getDevice(), maxRows = Math.floor((Number(device.limits?.maxStorageBufferBindingSize) || 0) / 16), groups = new Map(), results = new Array(normalizedBatches.length);
      if (pipelineDevice !== device) { const module = device.createShaderModule({ code: shaderSource }); pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } }); bindGroupLayout = pipeline.getBindGroupLayout(0); pipelineDevice = device; }
      normalizedBatches.forEach((rows, index) => { const paddedCount = nextPowerOfTwo(rows.length), group = groups.get(paddedCount) || []; group.push({ index, rows }); groups.set(paddedCount, group); });
      const gpuJobs = [];
      for (const [paddedCount, group] of groups) {
        if (paddedCount * group.length > maxRows) { for (const item of group) results[item.index] = fallback('frontier-ranker-storage-capacity', item.rows); continue; }
        // Submit every eligible GPU batch before running the CPU oracle. The
        // oracle remains mandatory for exact parity, but its synchronous sort
        // can now overlap the device queue's submitted work instead of
        // delaying all dispatches up front.
        gpuJobs.push({ group, promise: runGpuMany(device, group.map(item => item.rows), pipeline, bindGroupLayout, paddedCount) });
      }
      const cpuResults = normalizedBatches.map(rows => cpuRankFrontierRows(rows));
      for (const { group, promise } of gpuJobs) {
        const gpuIndices = await promise;
        for (const [groupIndex, item] of group.entries()) {
          const indices = gpuIndices[groupIndex], parity = JSON.stringify(indices) === JSON.stringify(cpuResults[item.index].indices);
          results[item.index] = parity
            ? Object.freeze({ schema: WEBGPU_FRONTIER_RANKER_SCHEMA, status: 'completed', backend: 'webgpu', parity: 'verified', algorithm: 'multi-pass-bitonic-sort-batched', indices, rowCount: item.rows.length })
            : fallback('oracle-parity-mismatch', item.rows, { observedIndices: indices.slice(0, 64), expectedIndices: cpuResults[item.index].indices.slice(0, 64) });
        }
      }
      return results;
    } catch (error) { pipelineDevice = null; pipeline = null; bindGroupLayout = null; deviceCache.reset(); return fallbackMany(`webgpu-execution-failed:${error?.message || String(error)}`, normalizedBatches); }
  };
  return Object.freeze({
    availability,
    async rank(rows) {
      const result = (await rankMany([rows]))[0];
      return result?.algorithm === 'multi-pass-bitonic-sort-batched' ? Object.freeze({ ...result, algorithm: 'multi-pass-bitonic-sort' }) : result;
    },
    rankMany,
  });
}

export { SHADER as DEFAULT_SHADER };
