import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { DEFAULT_FRONTIER_GRID, createFrontierMaskFromCells } from './webgpu-frontier-validator.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';
import { createWebGpuPipelineCache } from './webgpu-pipeline-cache.js';

export const WEBGPU_FRONTIER_EVALUATOR_SCHEMA = 'tdotdh.webgpu-frontier-evaluator.v0';
export const FRONTIER_SCORE_TERM_COUNT = 8;

const SHADER = `
struct Params {
  candidateCount: u32,
  wordCount: u32,
  termCount: u32,
  reserved: u32,
};
@group(0) @binding(0) var<storage, read> parentMasks: array<u32>;
@group(0) @binding(1) var<storage, read> candidateMasks: array<u32>;
@group(0) @binding(2) var<storage, read> scoreTerms: array<i32>;
@group(0) @binding(3) var<storage, read_write> validity: array<u32>;
@group(0) @binding(4) var<storage, read_write> scores: array<i32>;
@group(0) @binding(5) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.candidateCount) { return; }
  let maskBase = id.x * params.wordCount;
  var valid = true;
  for (var word: u32 = 0u; word < params.wordCount; word++) {
    if ((parentMasks[maskBase + word] & candidateMasks[maskBase + word]) != 0u) { valid = false; }
  }
  let scoreBase = id.x * params.termCount;
  var score: i32 = 0;
  for (var term: u32 = 0u; term < params.termCount; term++) { score += scoreTerms[scoreBase + term]; }
  validity[id.x] = select(0u, 1u, valid);
  scores[id.x] = score;
}`;

function normalizeGrid(grid = DEFAULT_FRONTIER_GRID) {
  const value = { ...DEFAULT_FRONTIER_GRID, ...grid };
  for (const key of ['width', 'height']) {
    if (!Number.isSafeInteger(value[key]) || value[key] <= 0 || value[key] > 128) throw new TypeError(`grid.${key} must be a positive safe integer at most 128`);
  }
  for (const key of ['originX', 'originY']) {
    if (!Number.isSafeInteger(value[key])) throw new TypeError(`grid.${key} must be a safe integer`);
  }
  return Object.freeze({ width: value.width, height: value.height, originX: value.originX, originY: value.originY, wordCount: Math.ceil((value.width * value.height) / 32) });
}

function normalizeTerm(value, label) {
  if (!Number.isSafeInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new TypeError(`${label} must be a signed 32-bit integer`);
  return value;
}

function normalizeCandidates(candidates, grid) {
  if (!Array.isArray(candidates) || candidates.length === 0) throw new TypeError('frontier candidates must be a non-empty array');
  return candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') throw new TypeError(`frontier candidate ${index} must be an object`);
    const parentMask = candidate.parentMask instanceof Uint32Array ? Uint32Array.from(candidate.parentMask) : Uint32Array.from(candidate.parentMask || []);
    const candidateMask = candidate.candidateMask instanceof Uint32Array ? Uint32Array.from(candidate.candidateMask) : Uint32Array.from(candidate.candidateMask || []);
    if (parentMask.length !== grid.wordCount || candidateMask.length !== grid.wordCount) throw new RangeError(`frontier candidate ${index} masks must contain ${grid.wordCount} words`);
    const scoreTerms = Array.isArray(candidate.scoreTerms) || candidate.scoreTerms instanceof Int32Array ? Array.from(candidate.scoreTerms) : [];
    if (scoreTerms.length !== FRONTIER_SCORE_TERM_COUNT) throw new RangeError(`frontier candidate ${index}.scoreTerms must contain ${FRONTIER_SCORE_TERM_COUNT} terms`);
    return Object.freeze({ parentMask, candidateMask, scoreTerms: scoreTerms.map((value, term) => normalizeTerm(value, `frontier candidate ${index}.scoreTerms[${term}]`)) });
  });
}

function flattenMasks(candidates, property, wordCount) {
  const flat = new Uint32Array(candidates.length * wordCount);
  candidates.forEach((candidate, index) => flat.set(candidate[property], index * wordCount));
  return flat;
}

function flattenTerms(candidates) {
  const flat = new Int32Array(candidates.length * FRONTIER_SCORE_TERM_COUNT);
  candidates.forEach((candidate, index) => flat.set(candidate.scoreTerms, index * FRONTIER_SCORE_TERM_COUNT));
  return flat;
}

export function createFrontierEvaluationCandidate({ parentCells, candidateCells, scoreTerms } = {}, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid);
  return Object.freeze({
    parentMask: createFrontierMaskFromCells(parentCells, normalizedGrid),
    candidateMask: createFrontierMaskFromCells(candidateCells, normalizedGrid),
    scoreTerms: Array.from(scoreTerms || [], value => normalizeTerm(value, 'scoreTerms entry')),
  });
}

export function cpuEvaluateFrontierCandidates(candidates, grid = DEFAULT_FRONTIER_GRID) {
  const normalizedGrid = normalizeGrid(grid);
  const normalized = normalizeCandidates(candidates, normalizedGrid);
  const validity = normalized.map(candidate => {
    for (let word = 0; word < normalizedGrid.wordCount; word += 1) if ((candidate.parentMask[word] & candidate.candidateMask[word]) !== 0) return 0;
    return 1;
  });
  const scores = normalized.map(candidate => candidate.scoreTerms.reduce((total, term) => total + term, 0));
  return Object.freeze({ schema: WEBGPU_FRONTIER_EVALUATOR_SCHEMA, status: 'completed', backend: 'cpu-oracle', validity, scores, acceptedIndices: validity.flatMap((value, index) => value ? [index] : []), candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, parity: 'oracle' });
}

function unavailable(reason, grid) {
  return Object.freeze({ schema: WEBGPU_FRONTIER_EVALUATOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason), grid });
}

async function evaluateGpuBatch(device, normalized, grid, shaderSource, pipelineCache) {
  const parent = flattenMasks(normalized, 'parentMask', grid.wordCount);
  const candidate = flattenMasks(normalized, 'candidateMask', grid.wordCount);
  const terms = flattenTerms(normalized);
  const countBytes = Math.max(4, normalized.length * 4);
  const maskBytes = Math.max(4, parent.byteLength);
  const termBytes = Math.max(4, terms.byteLength);
  const parentBuffer = device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const candidateBuffer = device.createBuffer({ size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const termsBuffer = device.createBuffer({ size: termBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const validityBuffer = device.createBuffer({ size: countBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const scoresBuffer = device.createBuffer({ size: countBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const paramsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const validityReadback = device.createBuffer({ size: countBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const scoresReadback = device.createBuffer({ size: countBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(parentBuffer, 0, parent);
    device.queue.writeBuffer(candidateBuffer, 0, candidate);
    device.queue.writeBuffer(termsBuffer, 0, terms);
    device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([normalized.length, grid.wordCount, FRONTIER_SCORE_TERM_COUNT, 0]));
    const pipeline = pipelineCache.get(device, shaderSource);
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: parentBuffer } }, { binding: 1, resource: { buffer: candidateBuffer } }, { binding: 2, resource: { buffer: termsBuffer } },
      { binding: 3, resource: { buffer: validityBuffer } }, { binding: 4, resource: { buffer: scoresBuffer } }, { binding: 5, resource: { buffer: paramsBuffer } },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(normalized.length / 64)); pass.end();
    encoder.copyBufferToBuffer(validityBuffer, 0, validityReadback, 0, countBytes); encoder.copyBufferToBuffer(scoresBuffer, 0, scoresReadback, 0, countBytes);
    device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    await validityReadback.mapAsync(GPUMapMode.READ); const validity = Array.from(new Uint32Array(validityReadback.getMappedRange().slice(0, normalized.length * 4))); validityReadback.unmap();
    await scoresReadback.mapAsync(GPUMapMode.READ); const scores = Array.from(new Int32Array(scoresReadback.getMappedRange().slice(0, normalized.length * 4))); scoresReadback.unmap();
    return { validity, scores };
  } finally {
    for (const buffer of [parentBuffer, candidateBuffer, termsBuffer, validityBuffer, scoresBuffer, paramsBuffer, validityReadback, scoresReadback]) buffer.destroy();
  }
}

export function createWebGpuFrontierEvaluator({ gpu = globalThis.navigator?.gpu, grid = DEFAULT_FRONTIER_GRID, requiredLimits = { maxStorageBufferBindingSize: 65536 }, shaderSource = SHADER, deviceCache = createWebGpuDeviceCache({ gpu }) } = {}) {
  if (typeof shaderSource !== 'string' || !shaderSource.trim()) throw new TypeError('shaderSource must be a non-empty string');
  const normalizedGrid = normalizeGrid(grid), limits = { ...requiredLimits }, pipelineCache = createWebGpuPipelineCache();
  return Object.freeze({
    async availability() {
      const probe = await probeWebGpuCapabilities({ gpu, requiredLimits: limits });
      if (!probe.adapterAvailable) return unavailable('webgpu-adapter-unavailable', normalizedGrid);
      if (!probe.requiredLimitsSatisfied) return unavailable('webgpu-required-limits-unsatisfied', normalizedGrid);
      return Object.freeze({ schema: WEBGPU_FRONTIER_EVALUATOR_SCHEMA, status: 'available', backend: 'webgpu', grid: normalizedGrid });
    },
    async evaluate(candidates) {
      const normalized = normalizeCandidates(candidates, normalizedGrid);
      const cpu = cpuEvaluateFrontierCandidates(normalized, normalizedGrid);
      const status = await this.availability();
      if (status.status !== 'available') return Object.freeze({ ...status, validity: cpu.validity, scores: cpu.scores, acceptedIndices: cpu.acceptedIndices });
      let device;
      try {
        device = await deviceCache.getDevice();
        const maxBinding = Number(device.limits?.maxStorageBufferBindingSize) || 65536;
        const bytesPerMaskCandidate = normalizedGrid.wordCount * 4;
        const maxBatch = Math.max(1, Math.floor(maxBinding / Math.max(bytesPerMaskCandidate, 4)));
        const validity = [], scores = [];
        for (let offset = 0; offset < normalized.length; offset += maxBatch) {
          const result = await evaluateGpuBatch(device, normalized.slice(offset, offset + maxBatch), normalizedGrid, shaderSource, pipelineCache);
          validity.push(...result.validity); scores.push(...result.scores);
        }
        const parity = JSON.stringify(validity) === JSON.stringify(cpu.validity) && JSON.stringify(scores) === JSON.stringify(cpu.scores);
        if (!parity) return Object.freeze({ schema: WEBGPU_FRONTIER_EVALUATOR_SCHEMA, status: 'rejected', backend: 'webgpu', reason: 'oracle-parity-mismatch', validity: cpu.validity, scores: cpu.scores, acceptedIndices: cpu.acceptedIndices, candidateCount: normalized.length, wordCount: normalizedGrid.wordCount });
        return Object.freeze({ schema: WEBGPU_FRONTIER_EVALUATOR_SCHEMA, status: 'completed', backend: 'webgpu', validity, scores, acceptedIndices: validity.flatMap((value, index) => value ? [index] : []), candidateCount: normalized.length, wordCount: normalizedGrid.wordCount, parity: 'verified' });
      } catch (error) {
        deviceCache.reset();
        return Object.freeze({ ...unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, normalizedGrid), validity: cpu.validity, scores: cpu.scores, acceptedIndices: cpu.acceptedIndices });
      }
    },
  });
}

export { SHADER as DEFAULT_SHADER };
