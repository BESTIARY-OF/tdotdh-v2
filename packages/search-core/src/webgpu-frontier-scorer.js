import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';
import { createWebGpuPipelineCache } from './webgpu-pipeline-cache.js';

export const WEBGPU_FRONTIER_SCORER_SCHEMA = 'tdotdh.webgpu-frontier-scorer.v0';
export const MAX_FRONTIER_SCORE_ROWS = 65536;
export const FRONTIER_SCORE_WORKGROUP_SIZE = 64;
export const FRONTIER_SCORE_INPUT_STRIDE = 12;

export const DEFAULT_SHADER = `
struct ScoreInput {
  geometryScore: f32,
  targetProgress: f32,
  neighborCount: f32,
  targetNeighborCount: f32,
  coastBias: f32,
  perimeter: f32,
  gravityBias: f32,
  gravityTension: f32,
  inletBias: f32,
  inletRisk: f32,
  randomUnit: f32,
  flags: u32,
};
struct Params { rowCount: u32, reserved0: u32, reserved1: u32, reserved2: u32, };
@group(0) @binding(0) var<storage, read> inputs: array<ScoreInput>;
@group(0) @binding(1) var<storage, read_write> scores: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(${FRONTIER_SCORE_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.rowCount) { return; }
  let input = inputs[index];
  let targetActive = (input.flags & 1u) != 0u;
  let novelty = (input.flags & 2u) != 0u;
  let neighborActive = (input.flags & 4u) != 0u;
  let hint = (input.flags & 8u) != 0u;
  var score = input.geometryScore;
  if (targetActive) { score = score - 320.0 * input.targetProgress; }
  if (novelty) { score = score - 220.0; }
  if (neighborActive) {
    if (input.neighborCount == input.targetNeighborCount) { score = score - 600.0; }
    else { score = score + abs(input.neighborCount - input.targetNeighborCount) * 80.0; }
  }
  if (hint) { score = score - 220.0; }
  score = score + input.coastBias * input.perimeter * 2.5;
  score = score + input.gravityBias * input.gravityTension * 0.025;
  score = score + input.inletBias * input.inletRisk * 5.0;
  score = score + input.randomUnit * 12.0;
  scores[index] = score;
}`;

function finite(value, label, index) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`frontier score row ${index}.${label} must be finite`);
  return number;
}

function integer(value, label, index) {
  const number = finite(value, label, index);
  if (!Number.isSafeInteger(number)) throw new TypeError(`frontier score row ${index}.${label} must be an integer`);
  return number;
}

function normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_FRONTIER_SCORE_ROWS) throw new TypeError(`frontier score rows must contain 1-${MAX_FRONTIER_SCORE_ROWS} rows`);
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object') throw new TypeError(`frontier score row ${index} must be an object`);
    const flags = integer(row.flags ?? 0, 'flags', index);
    if (flags < 0 || flags > 0xffffffff) throw new RangeError(`frontier score row ${index}.flags must be a uint32`);
    return Object.freeze({
      geometryScore: finite(row.geometryScore, 'geometryScore', index),
      targetProgress: finite(row.targetProgress ?? 0, 'targetProgress', index),
      neighborCount: finite(row.neighborCount ?? 0, 'neighborCount', index),
      targetNeighborCount: finite(row.targetNeighborCount ?? 0, 'targetNeighborCount', index),
      coastBias: finite(row.coastBias ?? 0, 'coastBias', index),
      perimeter: finite(row.perimeter ?? 0, 'perimeter', index),
      gravityBias: finite(row.gravityBias ?? 0, 'gravityBias', index),
      gravityTension: finite(row.gravityTension ?? 0, 'gravityTension', index),
      inletBias: finite(row.inletBias ?? 0, 'inletBias', index),
      inletRisk: finite(row.inletRisk ?? 0, 'inletRisk', index),
      randomUnit: finite(row.randomUnit ?? 0, 'randomUnit', index),
      flags: flags >>> 0,
    });
  });
}

export function cpuScoreFrontierCandidate(row) {
  const targetActive = (row.flags & 1) !== 0, novelty = (row.flags & 2) !== 0, neighborActive = (row.flags & 4) !== 0, hint = (row.flags & 8) !== 0;
  let score = row.geometryScore;
  if (targetActive) score -= 320 * row.targetProgress;
  if (novelty) score -= 220;
  if (neighborActive) score += row.neighborCount === row.targetNeighborCount ? -600 : Math.abs(row.neighborCount - row.targetNeighborCount) * 80;
  if (hint) score -= 220;
  score += row.coastBias * row.perimeter * 2.5;
  score += row.gravityBias * row.gravityTension * 0.025;
  score += row.inletBias * row.inletRisk * 5;
  return score + row.randomUnit * 12;
}

export function cpuScoreFrontierCandidates(rows) {
  const normalized = normalizeRows(rows), scores = normalized.map(cpuScoreFrontierCandidate);
  return Object.freeze({ schema: WEBGPU_FRONTIER_SCORER_SCHEMA, status: 'completed', backend: 'cpu-oracle', parity: 'oracle', scores: Object.freeze(scores), candidateCount: normalized.length });
}

function unavailable(reason, cpu) {
  return Object.freeze({ ...cpu, schema: WEBGPU_FRONTIER_SCORER_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason) });
}

function packRows(rows) {
  const buffer = new ArrayBuffer(rows.length * FRONTIER_SCORE_INPUT_STRIDE * 4), view = new DataView(buffer);
  rows.forEach((row, index) => {
    const base = index * FRONTIER_SCORE_INPUT_STRIDE * 4;
    view.setFloat32(base, row.geometryScore, true);
    view.setFloat32(base + 4, row.targetProgress, true);
    view.setFloat32(base + 8, row.neighborCount, true);
    view.setFloat32(base + 12, row.targetNeighborCount, true);
    view.setFloat32(base + 16, row.coastBias, true);
    view.setFloat32(base + 20, row.perimeter, true);
    view.setFloat32(base + 24, row.gravityBias, true);
    view.setFloat32(base + 28, row.gravityTension, true);
    view.setFloat32(base + 32, row.inletBias, true);
    view.setFloat32(base + 36, row.inletRisk, true);
    view.setFloat32(base + 40, row.randomUnit, true);
    view.setUint32(base + 44, row.flags, true);
  });
  return buffer;
}

async function runGpu(device, rows, shaderSource, pipelineCache) {
  const inputBytes = Math.max(48, rows.length * FRONTIER_SCORE_INPUT_STRIDE * 4), outputBytes = Math.max(4, rows.length * 4);
  const inputs = device.createBuffer({ size: inputBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const scores = device.createBuffer({ size: outputBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const readback = device.createBuffer({ size: outputBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(inputs, 0, packRows(rows));
    device.queue.writeBuffer(params, 0, new Uint32Array([rows.length, 0, 0, 0]));
    const pipeline = pipelineCache.get(device, shaderSource);
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inputs } }, { binding: 1, resource: { buffer: scores } }, { binding: 2, resource: { buffer: params } }] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(rows.length / FRONTIER_SCORE_WORKGROUP_SIZE)); pass.end();
    encoder.copyBufferToBuffer(scores, 0, readback, 0, outputBytes); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    await readback.mapAsync(GPUMapMode.READ); const values = new Float32Array(readback.getMappedRange().slice(0, rows.length * 4)); const result = Array.from(values); readback.unmap(); return result;
  } finally { for (const buffer of [inputs, scores, params, readback]) buffer.destroy(); }
}

export function createWebGpuFrontierScorer({ gpu = globalThis.navigator?.gpu, requiredLimits = { maxComputeWorkgroupSizeX: FRONTIER_SCORE_WORKGROUP_SIZE }, shaderSource = DEFAULT_SHADER, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  let availabilityPromise = null;
  const pipelineCache = createWebGpuPipelineCache();
  const availability = async () => {
    if (!availabilityPromise) availabilityPromise = probeWebGpuCapabilities({ gpu, requiredLimits }).then(probe => probe.adapterAvailable && probe.requiredLimitsSatisfied
      ? Object.freeze({ schema: WEBGPU_FRONTIER_SCORER_SCHEMA, status: 'available', backend: 'webgpu' })
      : Object.freeze({ schema: WEBGPU_FRONTIER_SCORER_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable' }));
    return availabilityPromise;
  };
  return Object.freeze({
    availability,
    async score(rows) {
      const normalized = normalizeRows(rows), cpu = cpuScoreFrontierCandidates(normalized), status = await availability();
      if (status.status !== 'available') return unavailable(status.reason, cpu);
      try {
        const gpuScores = await runGpu(await deviceCache.getDevice(), normalized, shaderSource, pipelineCache);
        const parity = gpuScores.every((value, index) => Math.abs(value - cpu.scores[index]) <= Math.max(0.0005, Math.abs(cpu.scores[index]) * 0.00001));
        if (!parity) return unavailable('oracle-parity-mismatch', cpu);
        return Object.freeze({ ...cpu, status: 'completed', backend: 'webgpu', parity: 'verified', algorithm: 'parallel-score-map', scores: Object.freeze(gpuScores) });
      } catch (error) { deviceCache.reset(); return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, cpu); }
    },
  });
}
