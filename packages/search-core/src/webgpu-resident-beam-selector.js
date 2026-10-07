import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';
import { cpuScoreFrontierCandidates } from './webgpu-frontier-scorer.js';

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

const SCORE_INPUT_SHADER = `
struct Input {
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
struct Row { score: f32, tie: u32, index: u32, reserved: u32, };
struct Params { rowCount: u32, paddedCount: u32, reserved0: u32, reserved1: u32, };
@group(0) @binding(0) var<storage, read> inputs: array<Input>;
@group(0) @binding(1) var<storage, read_write> rows: array<Row>;
@group(0) @binding(2) var<uniform> params: Params;

fn score(input: Input) -> f32 {
  let targetActive = (input.flags & 1u) != 0u;
  let novelty = (input.flags & 2u) != 0u;
  let neighborActive = (input.flags & 4u) != 0u;
  let hint = (input.flags & 8u) != 0u;
  var value = input.geometryScore;
  if (targetActive) { value = value - 320.0 * input.targetProgress; }
  if (novelty) { value = value - 220.0; }
  if (neighborActive) {
    if (input.neighborCount == input.targetNeighborCount) { value = value - 600.0; }
    else { value = value + abs(input.neighborCount - input.targetNeighborCount) * 80.0; }
  }
  if (hint) { value = value - 220.0; }
  value = value + input.coastBias * input.perimeter * 2.5;
  value = value + input.gravityBias * input.gravityTension * 0.025;
  value = value + input.inletBias * input.inletRisk * 5.0;
  return value + input.randomUnit * 12.0;
}

@compute @workgroup_size(${RESIDENT_BEAM_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.paddedCount) { return; }
  if (id.x < params.rowCount) {
    rows[id.x] = Row(score(inputs[id.x]), id.x, id.x, 0u);
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

function normalizeScoreInputs(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_RESIDENT_BEAM_ROWS) throw new TypeError(`resident beam score inputs must contain 1-${MAX_RESIDENT_BEAM_ROWS} rows`);
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object') throw new TypeError(`resident beam score input ${index} must be an object`);
    const normalized = Object.freeze({
      geometryScore: Number(row.geometryScore),
      targetProgress: Number(row.targetProgress ?? 0),
      neighborCount: Number(row.neighborCount ?? 0),
      targetNeighborCount: Number(row.targetNeighborCount ?? 0),
      coastBias: Number(row.coastBias ?? 0),
      perimeter: Number(row.perimeter ?? 0),
      gravityBias: Number(row.gravityBias ?? 0),
      gravityTension: Number(row.gravityTension ?? 0),
      inletBias: Number(row.inletBias ?? 0),
      inletRisk: Number(row.inletRisk ?? 0),
      randomUnit: Number(row.randomUnit ?? 0),
      flags: Number(row.flags ?? 0),
    });
    for (const key of ['geometryScore', 'targetProgress', 'neighborCount', 'targetNeighborCount', 'coastBias', 'perimeter', 'gravityBias', 'gravityTension', 'inletBias', 'inletRisk', 'randomUnit']) if (!Number.isFinite(normalized[key])) throw new TypeError(`resident beam score input ${index}.${key} must be finite`);
    if (!Number.isSafeInteger(normalized.flags) || normalized.flags < 0 || normalized.flags > 0xffffffff) throw new TypeError(`resident beam score input ${index}.flags must be a uint32`);
    return normalized;
  });
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function createPersistentGpuBeamRunner(device) {
  const usage = globalThis.GPUBufferUsage, mapMode = globalThis.GPUMapMode;
  let resources = null, queue = Promise.resolve();
  const destroy = () => {
    if (!resources) return;
    for (const buffer of Object.values(resources.buffers)) buffer.destroy();
    resources = null;
  };
  const ensure = paddedCount => {
    const rowCapacity = nextPowerOfTwo(Math.max(1, paddedCount));
    if (resources && resources.rowCapacity >= rowCapacity) return resources;
    destroy();
    const buffers = {
      inputs: device.createBuffer({ size: rowCapacity * 48, usage: usage.STORAGE | usage.COPY_DST }),
      rowsA: device.createBuffer({ size: rowCapacity * 16, usage: usage.STORAGE | usage.COPY_SRC }),
      rowsB: device.createBuffer({ size: rowCapacity * 16, usage: usage.STORAGE | usage.COPY_SRC }),
      params: device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST }),
      readback: device.createBuffer({ size: rowCapacity * 16, usage: usage.MAP_READ | usage.COPY_DST }),
    };
    const scoreModule = device.createShaderModule({ code: SCORE_SHADER }), scoreInputModule = device.createShaderModule({ code: SCORE_INPUT_SHADER }), sortModule = device.createShaderModule({ code: SORT_SHADER });
    const scorePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: scoreModule, entryPoint: 'main' } }), scoreInputPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: scoreInputModule, entryPoint: 'main' } }), sortPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: sortModule, entryPoint: 'main' } });
    const scoreEntries = (pipeline, output) => ({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buffers.inputs } }, { binding: 1, resource: { buffer: output } }, { binding: 2, resource: { buffer: buffers.params } }] });
    const scoreBindGroup = device.createBindGroup(scoreEntries(scorePipeline, buffers.rowsA)), scoreInputBindGroup = device.createBindGroup(scoreEntries(scoreInputPipeline, buffers.rowsA));
    const sortEntries = (input, output) => ({ layout: sortPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: output } }, { binding: 2, resource: { buffer: buffers.params } }] });
    const sortAToB = device.createBindGroup(sortEntries(buffers.rowsA, buffers.rowsB)), sortBToA = device.createBindGroup(sortEntries(buffers.rowsB, buffers.rowsA));
    resources = { buffers, scorePipeline, scoreInputPipeline, sortPipeline, scoreBindGroup, scoreInputBindGroup, sortAToB, sortBToA, rowCapacity };
    return resources;
  };
  const checkCancelled = (signal, isCancelled) => {
    if (signal?.aborted || isCancelled?.()) { const error = new Error('resident beam selection cancelled'); error.name = 'AbortError'; throw error; }
  };
  const runExclusive = async (rows, retain, signal, isCancelled, scoreInputs) => {
    const paddedCount = nextPowerOfTwo(rows.length), current = ensure(paddedCount), { buffers } = current;
    checkCancelled(signal, isCancelled);
    device.queue.writeBuffer(buffers.inputs, 0, scoreInputs ? packScoreInputs(rows) : packRows(rows));
    device.queue.writeBuffer(buffers.params, 0, new Uint32Array([rows.length, paddedCount, 0, 0]));
    let encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(scoreInputs ? current.scoreInputPipeline : current.scorePipeline); pass.setBindGroup(0, scoreInputs ? current.scoreInputBindGroup : current.scoreBindGroup); pass.dispatchWorkgroups(Math.ceil(paddedCount / RESIDENT_BEAM_WORKGROUP_SIZE)); pass.end(); device.queue.submit([encoder.finish()]);
    let sourceIsA = true;
    for (let k = 2; k <= paddedCount; k *= 2) for (let j = k / 2; j >= 1; j /= 2) {
      checkCancelled(signal, isCancelled);
      device.queue.writeBuffer(buffers.params, 0, new Uint32Array([rows.length, paddedCount, j, k]));
      encoder = device.createCommandEncoder(); pass = encoder.beginComputePass(); pass.setPipeline(current.sortPipeline); pass.setBindGroup(0, sourceIsA ? current.sortAToB : current.sortBToA); pass.dispatchWorkgroups(Math.ceil(paddedCount / RESIDENT_BEAM_WORKGROUP_SIZE)); pass.end(); device.queue.submit([encoder.finish()]); sourceIsA = !sourceIsA;
    }
    checkCancelled(signal, isCancelled);
    encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(sourceIsA ? buffers.rowsA : buffers.rowsB, 0, buffers.readback, 0, Math.max(1, retain) * 16); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone(); checkCancelled(signal, isCancelled);
    await buffers.readback.mapAsync(mapMode.READ); const view = new DataView(buffers.readback.getMappedRange()), indices = []; for (let index = 0; index < retain; index++) indices.push(view.getUint32(index * 16 + 8, true)); buffers.readback.unmap(); return indices;
  };
  return Object.freeze({
    run(rows, retain, signal, isCancelled, scoreInputs) { const task = queue.then(() => runExclusive(rows, retain, signal, isCancelled, scoreInputs)); queue = task.catch(() => {}); return task; },
    reset() { queue = Promise.resolve(); destroy(); },
  });
}

export function cpuSelectResidentBeam(rows, retain) {
  const normalized = normalizeRows(rows), limit = Math.min(Math.max(0, Number(retain) || 0), normalized.length);
  const indices = normalized.map((row, index) => index).sort((left, right) => normalized[left].score - normalized[right].score || normalized[left].tie - normalized[right].tie || left - right).slice(0, limit);
  return Object.freeze({ schema: WEBGPU_RESIDENT_BEAM_SELECTOR_SCHEMA, status: 'completed', backend: 'cpu-oracle', parity: 'oracle', algorithm: 'resident-score-rank', indices: Object.freeze(indices), rowCount: normalized.length, selectedCount: indices.length });
}

export function cpuSelectResidentScoreInputs(rows, retain) {
  const normalized = normalizeScoreInputs(rows), scores = cpuScoreFrontierCandidates(normalized).scores, selection = cpuSelectResidentBeam(scores.map(score => ({ score, tie: 0 })), retain);
  return Object.freeze({ ...selection, scores: Object.freeze([...scores]), algorithm: 'resident-score-input-rank' });
}

function unavailable(reason, rows, retain) {
  return Object.freeze({ ...cpuSelectResidentBeam(rows, retain), schema: WEBGPU_RESIDENT_BEAM_SELECTOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason), readback: 'cpu-fallback' });
}

function unavailableScoreInputs(reason, rows, retain) {
  return Object.freeze({ ...cpuSelectResidentScoreInputs(rows, retain), schema: WEBGPU_RESIDENT_BEAM_SELECTOR_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: String(reason), readback: 'cpu-fallback' });
}

function packRows(rows) {
  const packed = new ArrayBuffer(rows.length * 8), view = new DataView(packed);
  rows.forEach((row, index) => { view.setFloat32(index * 8, row.score, true); view.setUint32(index * 8 + 4, row.tie, true); });
  return packed;
}

function packScoreInputs(rows) {
  const packed = new ArrayBuffer(rows.length * 48), view = new DataView(packed);
  rows.forEach((row, index) => {
    const base = index * 48;
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
  return packed;
}

async function runGpu(device, rows, retain, signal, isCancelled, { scoreInputs = false } = {}) {
  const paddedCount = nextPowerOfTwo(rows.length), rowBytes = paddedCount * 16, inputBytes = scoreInputs ? rows.length * 48 : rows.length * 8;
  const inputs = device.createBuffer({ size: Math.max(8, inputBytes), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const rowsA = device.createBuffer({ size: rowBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const rowsB = device.createBuffer({ size: rowBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const readback = device.createBuffer({ size: Math.max(1, retain) * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const checkCancelled = () => { if (signal?.aborted || isCancelled?.()) { const error = new Error('resident beam selection cancelled'); error.name = 'AbortError'; throw error; } };
  try {
    checkCancelled();
    device.queue.writeBuffer(inputs, 0, scoreInputs ? packScoreInputs(rows) : packRows(rows));
    device.queue.writeBuffer(params, 0, new Uint32Array([rows.length, paddedCount, 0, 0]));
    const scoreModule = device.createShaderModule({ code: scoreInputs ? SCORE_INPUT_SHADER : SCORE_SHADER }), scorePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: scoreModule, entryPoint: 'main' } });
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
  let availabilityPromise = null, persistentRunner = null;
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
        if (!persistentRunner) persistentRunner = createPersistentGpuBeamRunner(device);
        const indices = await persistentRunner.run(normalized, cpu.selectedCount, signal, isCancelled, false), parity = JSON.stringify(indices) === JSON.stringify(cpu.indices);
        return parity ? Object.freeze({ ...cpu, status: 'completed', backend: 'webgpu', parity: 'verified', readback: 'selected-indices', algorithm: 'resident-score-rank' }) : unavailable('oracle-parity-mismatch', normalized, retain);
      } catch (error) { persistentRunner?.reset(); persistentRunner = null; deviceCache.reset(); if (error?.name === 'AbortError') return Object.freeze({ ...cpu, status: 'cancelled', backend: 'webgpu', parity: 'deferred', reason: 'resident-beam-selection-cancelled' }); return unavailable(`webgpu-execution-failed:${error?.message || String(error)}`, normalized, retain); }
    },
    async selectScoreInputs(rows, retain, { signal, isCancelled } = {}) {
      const normalized = normalizeScoreInputs(rows), cpu = cpuSelectResidentScoreInputs(normalized, retain), status = await availability();
      if (status.status !== 'available') return unavailableScoreInputs(status.reason, normalized, retain);
      try {
        const device = await deviceCache.getDevice(), paddedCount = nextPowerOfTwo(normalized.length), maxRows = Math.floor((Number(device.limits?.maxStorageBufferBindingSize) || 0) / 16);
        if (maxRows < paddedCount) return unavailableScoreInputs('resident-beam-storage-capacity', normalized, retain);
        if (!persistentRunner) persistentRunner = createPersistentGpuBeamRunner(device);
        const indices = await persistentRunner.run(normalized, cpu.selectedCount, signal, isCancelled, true), parity = JSON.stringify(indices) === JSON.stringify(cpu.indices);
        return parity ? Object.freeze({ ...cpu, status: 'completed', backend: 'webgpu', parity: 'verified', readback: 'selected-indices', algorithm: 'resident-score-input-rank' }) : unavailableScoreInputs('oracle-parity-mismatch', normalized, retain);
      } catch (error) { persistentRunner?.reset(); persistentRunner = null; deviceCache.reset(); if (error?.name === 'AbortError') return Object.freeze({ ...cpu, status: 'cancelled', backend: 'webgpu', parity: 'deferred', reason: 'resident-score-rank-cancelled' }); return unavailableScoreInputs(`webgpu-execution-failed:${error?.message || String(error)}`, normalized, retain); }
    },
  });
}

export { SCORE_SHADER as RESIDENT_BEAM_SCORE_SHADER, SCORE_INPUT_SHADER as RESIDENT_BEAM_SCORE_INPUT_SHADER, SORT_SHADER as RESIDENT_BEAM_SORT_SHADER };
