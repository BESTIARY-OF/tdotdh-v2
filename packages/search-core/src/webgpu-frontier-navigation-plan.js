import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';

export const WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA = 'tdotdh.webgpu-frontier-navigation-plan.v0';
export const FRONTIER_NAVIGATION_PLAN_STRIDE = 8;
export const FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE = 64;
export const FRONTIER_NAVIGATION_PLAN_SHADER = `
struct Params { rowCount: u32, planCount: u32, reserved0: u32, reserved1: u32 };
@group(0) @binding(0) var<storage, read> rows: array<i32>;
@group(0) @binding(1) var<storage, read_write> first: array<u32>;
@group(0) @binding(2) var<storage, read_write> counts: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE})
fn discover(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.rowCount) { return; }
  let base = id.x * ${FRONTIER_NAVIGATION_PLAN_STRIDE}u;
  let plan = rows[base];
  let target = rows[base + 1u];
  var isFirst = 1u;
  var count = 0u;
  for (var previous: u32 = 0u; previous < params.rowCount; previous = previous + 1u) {
    let priorBase = previous * ${FRONTIER_NAVIGATION_PLAN_STRIDE}u;
    if (rows[priorBase] == plan && rows[priorBase + 1u] == target) {
      count = count + 1u;
      if (previous < id.x) { isFirst = 0u; }
    }
  }
  first[id.x] = isFirst;
  counts[id.x] = count;
}

@group(0) @binding(0) var<storage, read> selectRows: array<i32>;
@group(0) @binding(1) var<storage, read> selectFirst: array<u32>;
@group(0) @binding(2) var<storage, read> selectCounts: array<u32>;
@group(0) @binding(3) var<storage, read_write> selected: array<u32>;
@group(0) @binding(4) var<uniform> selectParams: Params;

@compute @workgroup_size(${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE})
fn select(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= selectParams.rowCount) { return; }
  let base = id.x * ${FRONTIER_NAVIGATION_PLAN_STRIDE}u;
  let plan = selectRows[base];
  let target = selectRows[base + 1u];
  var bestCount = 0xffffffffu;
  var bestTarget = 0xffffffffu;
  for (var group: u32 = 0u; group < selectParams.rowCount; group = group + 1u) {
    if (selectFirst[group] == 0u) { continue; }
    let groupBase = group * ${FRONTIER_NAVIGATION_PLAN_STRIDE}u;
    if (selectRows[groupBase] != plan) { continue; }
    let groupCount = selectCounts[group];
    let groupTarget = selectRows[groupBase + 1u];
    if (groupCount < bestCount || (groupCount == bestCount && groupTarget < bestTarget)) { bestCount = groupCount; bestTarget = groupTarget; }
  }
  selected[id.x] = select(select(0u, 1u, selectCounts[id.x] == bestCount && target == bestTarget), 0u, plan >= i32(selectParams.planCount));
}
`;

function uint(value, label, index) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x7fffffff) throw new TypeError(`navigation row ${index}.${label} must be a non-negative int32`);
  return value | 0;
}

function sint(value, label, index) {
  if (!Number.isSafeInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new TypeError(`navigation row ${index}.${label} must be an int32`);
  return value | 0;
}

function normalizeRow(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError(`navigation row ${index} must be an object`);
  return Object.freeze({
    planIndex: uint(row.planIndex, 'planIndex', index),
    targetOrdinal: uint(row.targetOrdinal, 'targetOrdinal', index),
    pieceId: uint(row.pieceId, 'pieceId', index),
    candidateIndex: uint(row.candidateIndex, 'candidateIndex', index),
    originX: sint(row.originX, 'originX', index),
    originY: sint(row.originY, 'originY', index),
    targetX: sint(row.targetX, 'targetX', index),
    targetY: sint(row.targetY, 'targetY', index),
  });
}

function digest(values) {
  let hash = 2166136261;
  for (const value of values) hash = Math.imul(hash ^ (Number(value) >>> 0), 16777619) >>> 0;
  return `fnv1a32-${hash.toString(16).padStart(8, '0')}`;
}

function rowAt(plan, index) {
  const base = index * FRONTIER_NAVIGATION_PLAN_STRIDE;
  return {
    planIndex: plan.values[base],
    targetOrdinal: plan.values[base + 1],
    pieceId: plan.values[base + 2],
    candidateIndex: plan.values[base + 3],
    originX: plan.values[base + 4],
    originY: plan.values[base + 5],
    targetX: plan.values[base + 6],
    targetY: plan.values[base + 7],
  };
}

export function createWebGpuFrontierNavigationPlan(rows = []) {
  if (!Array.isArray(rows)) throw new TypeError('navigation plan rows must be an array');
  const normalized = rows.map(normalizeRow), values = new Int32Array(normalized.length * FRONTIER_NAVIGATION_PLAN_STRIDE);
  normalized.forEach((row, index) => {
    const base = index * FRONTIER_NAVIGATION_PLAN_STRIDE;
    values.set([row.planIndex, row.targetOrdinal, row.pieceId, row.candidateIndex, row.originX, row.originY, row.targetX, row.targetY], base);
  });
  return Object.freeze({ schema: WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA, rowCount: normalized.length, stride: FRONTIER_NAVIGATION_PLAN_STRIDE, values, inputDigest: digest(values) });
}

export function cpuSelectFrontierNavigationRows(plan, { planCount = null } = {}) {
  if (!plan || plan.schema !== WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA || plan.stride !== FRONTIER_NAVIGATION_PLAN_STRIDE || !(plan.values instanceof Int32Array)) throw new TypeError('navigation plan is invalid');
  const groups = new Map();
  let inferredPlanCount = 0;
  for (let index = 0; index < plan.rowCount; index += 1) inferredPlanCount = Math.max(inferredPlanCount, rowAt(plan, index).planIndex + 1);
  const count = planCount == null ? inferredPlanCount : uint(planCount, 'planCount', 0);
  for (let index = 0; index < plan.rowCount; index += 1) {
    const row = rowAt(plan, index);
    if (row.planIndex >= count) throw new RangeError(`navigation row ${index} exceeds planCount`);
    const groupKey = `${row.planIndex}:${row.targetOrdinal}`, group = groups.get(groupKey) || { planIndex: row.planIndex, targetOrdinal: row.targetOrdinal, rows: [] };
    group.rows.push(index); groups.set(groupKey, group);
  }
  const winners = new Map();
  for (const group of groups.values()) {
    const current = winners.get(group.planIndex);
    if (!current || group.rows.length < current.rows.length || (group.rows.length === current.rows.length && group.targetOrdinal < current.targetOrdinal)) winners.set(group.planIndex, group);
  }
  const selectedRows = [];
  for (let planIndex = 0; planIndex < count; planIndex += 1) selectedRows.push(...(winners.get(planIndex)?.rows || []));
  return Object.freeze({ schema: WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA, status: 'completed', backend: 'cpu-oracle', parity: 'oracle', rowCount: plan.rowCount, selectedCount: selectedRows.length, selectedRows: Uint32Array.from(selectedRows), planCount: count, inputDigest: plan.inputDigest });
}

async function runGpu(device, plan, planCount, shaderSource) {
  const usage = globalThis.GPUBufferUsage, mapMode = globalThis.GPUMapMode;
  const rowBytes = Math.max(4, plan.values.byteLength), rowCountBytes = Math.max(4, plan.rowCount * 4), paramsBytes = 16;
  const rowsBuffer = device.createBuffer({ size: rowBytes, usage: usage.STORAGE | usage.COPY_DST });
  const firstBuffer = device.createBuffer({ size: rowCountBytes, usage: usage.STORAGE });
  const countsBuffer = device.createBuffer({ size: rowCountBytes, usage: usage.STORAGE });
  const selectedBuffer = device.createBuffer({ size: rowCountBytes, usage: usage.STORAGE | usage.COPY_SRC });
  const paramsBuffer = device.createBuffer({ size: paramsBytes, usage: usage.UNIFORM | usage.COPY_DST });
  const selectedReadback = device.createBuffer({ size: rowCountBytes, usage: usage.MAP_READ | usage.COPY_DST });
  try {
    device.queue.writeBuffer(rowsBuffer, 0, plan.values);
    device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([plan.rowCount, planCount, 0, 0]));
    const module = device.createShaderModule({ code: shaderSource });
    const discoverPipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'discover' } });
    const discoverGroup = device.createBindGroup({ layout: discoverPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: rowsBuffer } }, { binding: 1, resource: { buffer: firstBuffer } }, { binding: 2, resource: { buffer: countsBuffer } }, { binding: 3, resource: { buffer: paramsBuffer } }] });
    const selectPipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'select' } });
    const selectGroup = device.createBindGroup({ layout: selectPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: rowsBuffer } }, { binding: 1, resource: { buffer: firstBuffer } }, { binding: 2, resource: { buffer: countsBuffer } }, { binding: 3, resource: { buffer: selectedBuffer } }, { binding: 4, resource: { buffer: paramsBuffer } }] });
    const encoder = device.createCommandEncoder(), discoverPass = encoder.beginComputePass();
    discoverPass.setPipeline(discoverPipeline); discoverPass.setBindGroup(0, discoverGroup); discoverPass.dispatchWorkgroups(Math.ceil(plan.rowCount / FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE)); discoverPass.end();
    const selectPass = encoder.beginComputePass(); selectPass.setPipeline(selectPipeline); selectPass.setBindGroup(0, selectGroup); selectPass.dispatchWorkgroups(Math.ceil(plan.rowCount / FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE)); selectPass.end();
    encoder.copyBufferToBuffer(selectedBuffer, 0, selectedReadback, 0, rowCountBytes); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    await selectedReadback.mapAsync(mapMode.READ); const selectedValues = new Uint32Array(selectedReadback.getMappedRange().slice(0, rowCountBytes)); selectedReadback.unmap();
    return Array.from(selectedValues).flatMap((value, index) => value ? [index] : []);
  } finally { for (const buffer of [rowsBuffer, firstBuffer, countsBuffer, selectedBuffer, paramsBuffer, selectedReadback]) buffer.destroy(); }
}

export function createWebGpuFrontierNavigationScheduler({ gpu = globalThis.navigator?.gpu, requiredLimits = { maxStorageBufferBindingSize: 262144 }, shaderSource = FRONTIER_NAVIGATION_PLAN_SHADER, deviceCache = createWebGpuDeviceCache({ gpu }), accelerator = null } = {}) {
  let availabilityPromise = null;
  const availability = async () => {
    if (!availabilityPromise) availabilityPromise = probeWebGpuCapabilities({ gpu, requiredLimits }).then(probe => probe.adapterAvailable && probe.requiredLimitsSatisfied ? Object.freeze({ schema: WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA, status: 'available', backend: 'webgpu' }) : Object.freeze({ schema: WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable' }));
    return availabilityPromise;
  };
  return Object.freeze({
    availability,
    async select(rows, options = {}) {
      const plan = createWebGpuFrontierNavigationPlan(rows), oracle = cpuSelectFrontierNavigationRows(plan, options);
      if (!plan.rowCount || !oracle.planCount) return Object.freeze(oracle);
      if (typeof accelerator !== 'function') {
        const status = await availability();
        if (status.status !== 'available') return Object.freeze({ ...oracle, status: 'fallback', backend: 'cpu-oracle', reason: status.reason });
      }
      try {
        const result = typeof accelerator === 'function' ? await accelerator({ plan, oracle }) : { status: 'completed', selectedRows: await runGpu(await deviceCache.getDevice(), plan, oracle.planCount, shaderSource), dispatch: 'webgpu-navigation-plan' };
        const selected = result?.selectedRows instanceof Uint32Array ? result.selectedRows : Uint32Array.from(result?.selectedRows || []);
        if (result?.status !== 'completed' || selected.length !== oracle.selectedRows.length || JSON.stringify(Array.from(selected)) !== JSON.stringify(Array.from(oracle.selectedRows))) return Object.freeze({ ...oracle, status: 'rejected', backend: 'cpu-oracle', reason: 'navigation-oracle-parity-mismatch' });
        return Object.freeze({ ...oracle, status: 'completed', backend: 'webgpu', parity: 'verified', selectedRows: selected, dispatch: result.dispatch || 'navigation-plan' });
      } catch (error) {
        deviceCache.reset();
        return Object.freeze({ ...oracle, status: 'fallback', backend: 'cpu-oracle', reason: `navigation-accelerator-failed:${error?.message || String(error)}` });
      }
    },
  });
}

export function decodeWebGpuFrontierNavigationRow(plan, index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= plan.rowCount) throw new RangeError('navigation row index is out of bounds');
  return Object.freeze(rowAt(plan, index));
}
