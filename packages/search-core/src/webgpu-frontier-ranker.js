import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_FRONTIER_RANKER_SCHEMA = 'tdotdh.webgpu-frontier-ranker.v0';
export const MAX_FRONTIER_RANK_ROWS = 128;
const PAD_SCORE = 3.402823466e+38;
const SHADER = `
struct Params { rowCount: u32, reserved0: u32, reserved1: u32, reserved2: u32, };
@group(0) @binding(0) var<storage, read> inputScores: array<f32>;
@group(0) @binding(1) var<storage, read> inputTies: array<u32>;
@group(0) @binding(2) var<storage, read_write> outputIndices: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;
var<workgroup> scores: array<f32, ${MAX_FRONTIER_RANK_ROWS}>;
var<workgroup> ties: array<u32, ${MAX_FRONTIER_RANK_ROWS}>;
var<workgroup> indices: array<u32, ${MAX_FRONTIER_RANK_ROWS}>;

fn isAfter(left: u32, right: u32) -> bool {
  return scores[left] > scores[right] || (scores[left] == scores[right] && (ties[left] > ties[right] || (ties[left] == ties[right] && indices[left] > indices[right])));
}

@compute @workgroup_size(${MAX_FRONTIER_RANK_ROWS})
fn main(@builtin(local_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index < params.rowCount) { scores[index] = inputScores[index]; ties[index] = inputTies[index]; indices[index] = index; }
  else { scores[index] = ${PAD_SCORE}; ties[index] = 0xffffffffu; indices[index] = index; }
  workgroupBarrier();
  var k: u32 = 2u;
  loop {
    if (k > ${MAX_FRONTIER_RANK_ROWS}u) { break; }
    var j: u32 = k / 2u;
    loop {
      if (j == 0u) { break; }
      let partner = index ^ j;
      if (partner > index) {
        let ascending = (index & k) == 0u;
        let swap = (ascending && isAfter(index, partner)) || (!ascending && isAfter(partner, index));
        if (swap) {
          let score = scores[index]; scores[index] = scores[partner]; scores[partner] = score;
          let tie = ties[index]; ties[index] = ties[partner]; ties[partner] = tie;
          let value = indices[index]; indices[index] = indices[partner]; indices[partner] = value;
        }
      }
      workgroupBarrier();
      j = j / 2u;
    }
    k = k * 2u;
  }
  if (index < params.rowCount) { outputIndices[index] = indices[index]; }
}`;

function normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_FRONTIER_RANK_ROWS) throw new TypeError(`frontier rank rows must contain 1-${MAX_FRONTIER_RANK_ROWS} rows`);
  return rows.map((row, index) => Object.freeze({ score: Number(row?.score), tie: Number(row?.tie ?? index), index })).map((row, index) => {
    if (!Number.isFinite(row.score)) throw new TypeError(`frontier rank row ${index}.score must be finite`);
    if (!Number.isSafeInteger(row.tie) || row.tie < 0) throw new TypeError(`frontier rank row ${index}.tie must be a non-negative safe integer`);
    return row;
  });
}

export function cpuRankFrontierRows(rows) {
  const normalized = normalizeRows(rows), indices = normalized.map(row => row.index).sort((left, right) => normalized[left].score - normalized[right].score || normalized[left].tie - normalized[right].tie || left - right);
  return Object.freeze({ schema: WEBGPU_FRONTIER_RANKER_SCHEMA, status: 'completed', backend: 'cpu-oracle', parity: 'oracle', indices: Object.freeze(indices), rowCount: normalized.length });
}

async function runGpu(device, rows, shaderSource) {
  const scores = Float32Array.from(rows, row => row.score), ties = Uint32Array.from(rows, row => row.tie), bytes = MAX_FRONTIER_RANK_ROWS * 4;
  const inputScores = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }), inputTies = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }), outputIndices = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }), params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), readback = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(inputScores, 0, scores); device.queue.writeBuffer(inputTies, 0, ties); device.queue.writeBuffer(params, 0, new Uint32Array([rows.length, 0, 0, 0]));
    const module = device.createShaderModule({ code: shaderSource }), pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } }), bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inputScores } }, { binding: 1, resource: { buffer: inputTies } }, { binding: 2, resource: { buffer: outputIndices } }, { binding: 3, resource: { buffer: params } }] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(1); pass.end(); encoder.copyBufferToBuffer(outputIndices, 0, readback, 0, bytes); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone(); await readback.mapAsync(GPUMapMode.READ); const indices = Array.from(new Uint32Array(readback.getMappedRange().slice(0, rows.length * 4))); readback.unmap(); return indices;
  } finally { for (const buffer of [inputScores, inputTies, outputIndices, params, readback]) buffer.destroy(); }
}

export function createWebGpuFrontierRanker({ gpu = globalThis.navigator?.gpu, requiredLimits = { maxStorageBufferBindingSize: MAX_FRONTIER_RANK_ROWS * 4 }, shaderSource = SHADER, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  const limits = { ...requiredLimits }; let availabilityPromise = null;
  const fallback = (reason, rows) => Object.freeze({ ...cpuRankFrontierRows(rows), schema: WEBGPU_FRONTIER_RANKER_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason) });
  const availability = async () => {
    if (!availabilityPromise) availabilityPromise = probeWebGpuCapabilities({ gpu, requiredLimits: limits }).then(probe => probe.adapterAvailable && probe.requiredLimitsSatisfied ? Object.freeze({ schema: WEBGPU_FRONTIER_RANKER_SCHEMA, status: 'available', backend: 'webgpu' }) : fallback(probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable', [{ score: 0 }]));
    return availabilityPromise;
  };
  return Object.freeze({
    availability,
    async rank(rows) {
      const normalized = normalizeRows(rows), cpu = cpuRankFrontierRows(normalized), status = await availability();
      if (status.status !== 'available') return Object.freeze({ ...cpu, schema: WEBGPU_FRONTIER_RANKER_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: status.reason || 'webgpu-unavailable' });
      try {
        const indices = await runGpu(await deviceCache.getDevice(), normalized, shaderSource), parity = JSON.stringify(indices) === JSON.stringify(cpu.indices);
        return parity ? Object.freeze({ schema: WEBGPU_FRONTIER_RANKER_SCHEMA, status: 'completed', backend: 'webgpu', parity: 'verified', indices, rowCount: normalized.length }) : fallback('oracle-parity-mismatch', normalized);
      } catch (error) { deviceCache.reset(); return fallback(`webgpu-execution-failed:${error?.message || String(error)}`, normalized); }
    },
  });
}

export { SHADER as DEFAULT_SHADER };
