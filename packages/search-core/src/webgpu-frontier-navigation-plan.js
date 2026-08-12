import { probeWebGpuCapabilities } from './webgpu-capability-probe.js';
import { createWebGpuDeviceCache } from './webgpu-device-cache.js';
import { cpuSelectFrontierRecordIndices } from './webgpu-frontier-record-navigation.js';

export const WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA = 'tdotdh.webgpu-frontier-navigation-plan.v0';
export const FRONTIER_NAVIGATION_PLAN_STRIDE = 8;
export const FRONTIER_NAVIGATION_GROUP_STRIDE = 3;
export const FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE = 64;
export const FRONTIER_NAVIGATION_RESIDENT_MAX_TARGETS = 1024;
export const FRONTIER_NAVIGATION_RESIDENT_RECORD_STRIDE = 5;
export const FRONTIER_NAVIGATION_RESIDENT_COMPACTED_STRIDE = FRONTIER_NAVIGATION_RESIDENT_RECORD_STRIDE + 1;
export const FRONTIER_NAVIGATION_PLAN_SHADER = `
struct Params { rowCount: u32, planCount: u32, groupCount: u32, reserved0: u32 };
@group(0) @binding(0) var<storage, read> rows: array<i32>;
@group(0) @binding(1) var<storage, read> rowGroups: array<u32>;
@group(0) @binding(2) var<storage, read> groups: array<u32>;
@group(0) @binding(3) var<storage, read_write> bestGroups: array<u32>;
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE})
fn choose(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.planCount) { return; }
  var bestGroup = 0xffffffffu;
  var bestCount = 0xffffffffu;
  var bestTarget = 0xffffffffu;
  for (var group: u32 = 0u; group < params.groupCount; group = group + 1u) {
    let base = group * ${FRONTIER_NAVIGATION_GROUP_STRIDE}u;
    if (groups[base] != id.x) { continue; }
    let target = groups[base + 1u];
    let count = groups[base + 2u];
    if (count < bestCount || (count == bestCount && (target < bestTarget || (target == bestTarget && group < bestGroup)))) {
      bestGroup = group;
      bestCount = count;
      bestTarget = target;
    }
  }
  bestGroups[id.x] = bestGroup;
}

@group(0) @binding(0) var<storage, read> selectRows: array<i32>;
@group(0) @binding(1) var<storage, read> selectRowGroups: array<u32>;
@group(0) @binding(2) var<storage, read> selectBestGroups: array<u32>;
@group(0) @binding(3) var<storage, read_write> selected: array<u32>;
@group(0) @binding(4) var<uniform> selectParams: Params;

@compute @workgroup_size(${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE})
fn select(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= selectParams.rowCount) { return; }
  let base = id.x * ${FRONTIER_NAVIGATION_PLAN_STRIDE}u;
  let plan = u32(selectRows[base]);
  selected[id.x] = select(0u, 1u, plan < selectParams.planCount && selectRowGroups[id.x] == selectBestGroups[plan]);
}
`;

export const FRONTIER_NAVIGATION_RESIDENT_META_STRIDE = 5;
export const FRONTIER_NAVIGATION_RESIDENT_SHADER = `
struct Params { recordCount: u32, handleCount: u32, planCount: u32, reserved0: u32 };
@group(0) @binding(0) var<storage, read> records: array<i32>;
@group(0) @binding(1) var<storage, read> handleMeta: array<u32>;
@group(0) @binding(2) var<storage, read> piecePlans: array<u32>;
@group(0) @binding(3) var<storage, read_write> selected: array<u32>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var<storage, read> validity: array<u32>;
@group(0) @binding(6) var<storage, read_write> targetCounts: array<atomic<u32>>;

fn handleFor(recordIndex: u32) -> u32 {
  for (var handle: u32 = 0u; handle < params.handleCount; handle = handle + 1u) {
    let handleBase = handle * ${FRONTIER_NAVIGATION_RESIDENT_META_STRIDE}u;
    if (recordIndex >= handleMeta[handleBase] && recordIndex < handleMeta[handleBase] + handleMeta[handleBase + 1u]) { return handle; }
  }
  return 0xffffffffu;
}

fn planFor(handle: u32, recordIndex: u32) -> u32 {
  let handleBase = handle * ${FRONTIER_NAVIGATION_RESIDENT_META_STRIDE}u;
  let pieceId = u32(records[recordIndex * 5u]);
  if (pieceId >= handleMeta[handleBase + 3u]) { return 0xffffffffu; }
  return piecePlans[handleMeta[handleBase + 2u] + pieceId];
}

@compute @workgroup_size(${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE})
fn countResident(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.recordCount) { return; }
  let currentHandle = handleFor(id.x);
  if (currentHandle == 0xffffffffu) { return; }
  let currentMeta = currentHandle * ${FRONTIER_NAVIGATION_RESIDENT_META_STRIDE}u;
  if (validity[handleMeta[currentMeta + 4u] + id.x - handleMeta[currentMeta]] == 0u) { return; }
  let currentPlan = planFor(currentHandle, id.x);
  if (currentPlan == 0xffffffffu || currentPlan >= params.planCount) { return; }
  let currentTarget = u32(records[id.x * 5u + 1u]);
  if (currentTarget < ${FRONTIER_NAVIGATION_RESIDENT_MAX_TARGETS}u) { atomicAdd(&targetCounts[currentPlan * ${FRONTIER_NAVIGATION_RESIDENT_MAX_TARGETS}u + currentTarget], 1u); }
}

@compute @workgroup_size(${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE})
fn selectResident(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.recordCount) { return; }
  let currentHandle = handleFor(id.x);
  if (currentHandle == 0xffffffffu) { selected[id.x] = 0u; return; }
  let currentMeta = currentHandle * ${FRONTIER_NAVIGATION_RESIDENT_META_STRIDE}u;
  if (validity[handleMeta[currentMeta + 4u] + id.x - handleMeta[currentMeta]] == 0u) { selected[id.x] = 0u; return; }
  let currentPlan = planFor(currentHandle, id.x);
  if (currentPlan == 0xffffffffu || currentPlan >= params.planCount) { selected[id.x] = 0u; return; }
  var bestTarget = 0xffffffffu;
  var bestCount = 0xffffffffu;
  for (var candidateTarget: u32 = 0u; candidateTarget < ${FRONTIER_NAVIGATION_RESIDENT_MAX_TARGETS}u; candidateTarget = candidateTarget + 1u) {
    let candidateCount = atomicLoad(&targetCounts[currentPlan * ${FRONTIER_NAVIGATION_RESIDENT_MAX_TARGETS}u + candidateTarget]);
    if (candidateCount != 0u && (candidateCount < bestCount || (candidateCount == bestCount && candidateTarget < bestTarget))) { bestCount = candidateCount; bestTarget = candidateTarget; }
  }
  selected[id.x] = select(0u, 1u, u32(records[id.x * 5u + 1u]) == bestTarget);
}
`;

export const FRONTIER_NAVIGATION_RESIDENT_SCAN_SHADER = `
struct ScanParams { recordCount: u32, groupCount: u32, reserved0: u32, reserved1: u32 };
@group(0) @binding(0) var<storage, read> keep: array<u32>;
@group(0) @binding(1) var<storage, read_write> prefixes: array<u32>;
@group(0) @binding(2) var<storage, read_write> groupTotals: array<u32>;
@group(0) @binding(3) var<uniform> scanParams: ScanParams;
var<workgroup> scan: array<u32, ${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE}>;

@compute @workgroup_size(${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE})
fn scanResident(@builtin(global_invocation_id) globalId: vec3<u32>, @builtin(local_invocation_id) localId: vec3<u32>, @builtin(workgroup_id) groupId: vec3<u32>) {
  let lane = localId.x;
  let index = globalId.x;
  if (index < scanParams.recordCount) { scan[lane] = keep[index]; } else { scan[lane] = 0u; }
  workgroupBarrier();
  var offset = 1u;
  for (; offset < ${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE}u; offset = offset * 2u) {
    let source = (lane + 1u) * offset * 2u - 1u;
    if (source < ${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE}u && source >= offset) { scan[source] = scan[source] + scan[source - offset]; }
    workgroupBarrier();
  }
  if (lane == 0u) { groupTotals[groupId.x] = scan[${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE - 1}u]; scan[${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE - 1}u] = 0u; }
  workgroupBarrier();
  var down = ${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE / 2}u;
  loop {
    let source = (lane + 1u) * down * 2u - 1u;
    if (source < ${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE}u && source >= down) {
      let value = scan[source - down]; scan[source - down] = scan[source]; scan[source] = scan[source] + value;
    }
    workgroupBarrier();
    if (down == 1u) { break; }
    down = down / 2u;
  }
  if (index < scanParams.recordCount) { prefixes[index] = scan[lane]; }
}
`;

export const FRONTIER_NAVIGATION_RESIDENT_COMPACT_SHADER = `
struct ScanParams { recordCount: u32, groupCount: u32, reserved0: u32, reserved1: u32 };
@group(0) @binding(0) var<storage, read> records: array<i32>;
@group(0) @binding(1) var<storage, read> keepRecords: array<u32>;
@group(0) @binding(2) var<storage, read> recordPrefixes: array<u32>;
@group(0) @binding(3) var<storage, read> groupOffsets: array<u32>;
@group(0) @binding(4) var<storage, read_write> compactedRecords: array<i32>;
@group(0) @binding(5) var<uniform> compactParams: ScanParams;

@compute @workgroup_size(${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE})
fn compactResident(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= compactParams.recordCount || keepRecords[id.x] == 0u) { return; }
  let outputIndex = groupOffsets[id.x / ${FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE}u] + recordPrefixes[id.x];
  let sourceBase = id.x * ${FRONTIER_NAVIGATION_RESIDENT_RECORD_STRIDE}u;
  let outputBase = outputIndex * ${FRONTIER_NAVIGATION_RESIDENT_COMPACTED_STRIDE}u;
  compactedRecords[outputBase] = i32(id.x);
  for (var field = 0u; field < ${FRONTIER_NAVIGATION_RESIDENT_RECORD_STRIDE}u; field = field + 1u) { compactedRecords[outputBase + field + 1u] = records[sourceBase + field]; }
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

function finalizeNavigationPlan(values, groupIndices, groupRows) {
  const rowCount = values.length / FRONTIER_NAVIGATION_PLAN_STRIDE;
  const groupValues = new Uint32Array(groupRows.length * FRONTIER_NAVIGATION_GROUP_STRIDE);
  groupRows.forEach((group, index) => groupValues.set([group.planIndex, group.targetOrdinal, group.count], index * FRONTIER_NAVIGATION_GROUP_STRIDE));
  return Object.freeze({ schema: WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA, rowCount, stride: FRONTIER_NAVIGATION_PLAN_STRIDE, values, groupCount: groupRows.length, groupStride: FRONTIER_NAVIGATION_GROUP_STRIDE, groupIndices, groupValues, inputDigest: digest(values) });
}

function buildNavigationPlanFromNormalizedRows(normalized) {
  const values = new Int32Array(normalized.length * FRONTIER_NAVIGATION_PLAN_STRIDE), groupMap = new Map(), groupIndices = new Uint32Array(normalized.length), groupRows = [];
  normalized.forEach((row, index) => {
    const base = index * FRONTIER_NAVIGATION_PLAN_STRIDE;
    values.set([row.planIndex, row.targetOrdinal, row.pieceId, row.candidateIndex, row.originX, row.originY, row.targetX, row.targetY], base);
    const groupKey = `${row.planIndex}:${row.targetOrdinal}`;
    let groupIndex = groupMap.get(groupKey);
    if (groupIndex == null) {
      groupIndex = groupRows.length;
      groupMap.set(groupKey, groupIndex);
      groupRows.push({ planIndex: row.planIndex, targetOrdinal: row.targetOrdinal, count: 0 });
    }
    groupIndices[index] = groupIndex;
    groupRows[groupIndex].count += 1;
  });
  return finalizeNavigationPlan(values, groupIndices, groupRows);
}

export function createWebGpuFrontierNavigationPlan(rows = []) {
  if (!Array.isArray(rows)) throw new TypeError('navigation plan rows must be an array');
  return buildNavigationPlanFromNormalizedRows(rows.map(normalizeRow));
}

export function createWebGpuFrontierNavigationPlanFromCandidateRecords(entries = []) {
  if (!Array.isArray(entries)) throw new TypeError('candidate-record navigation entries must be an array');
  for (const [entryIndex, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError(`candidate-record navigation entry ${entryIndex} must be an object`);
    const records = entry.records, targetPool = entry.targetPool;
    if (!Array.isArray(records)) throw new TypeError(`candidate-record navigation entry ${entryIndex}.records must be an array`);
    if (!Array.isArray(targetPool)) throw new TypeError(`candidate-record navigation entry ${entryIndex}.targetPool must be an array`);
    for (const [recordIndex, record] of records.entries()) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError(`candidate record ${entryIndex}.${recordIndex} must be an object`);
      const target = targetPool[record.targetOrdinal];
      if (!target || !Number.isSafeInteger(target.x) || !Number.isSafeInteger(target.y)) throw new RangeError(`candidate record ${entryIndex}.${recordIndex} targetOrdinal is outside targetPool`);
    }
  }
  const values = [], groupIndices = [], groupMap = new Map(), groupRows = [];
  let rowIndex = 0;
  for (const [entryIndex, entry] of entries.entries()) {
    const planIndex = uint(entry.planIndex, 'planIndex', entryIndex);
    for (const [recordIndex, record] of entry.records.entries()) {
      const target = entry.targetPool[record.targetOrdinal], targetOrdinal = uint(record.targetOrdinal, 'targetOrdinal', recordIndex), pieceId = uint(record.pieceId, 'pieceId', recordIndex), candidateIndex = uint(record.inputOrdinal, 'inputOrdinal', recordIndex), originX = sint(record.originX, 'originX', recordIndex), originY = sint(record.originY, 'originY', recordIndex), targetX = sint(target.x, 'targetX', recordIndex), targetY = sint(target.y, 'targetY', recordIndex);
      values.push(planIndex, targetOrdinal, pieceId, candidateIndex, originX, originY, targetX, targetY);
      const groupKey = `${planIndex}:${targetOrdinal}`;
      let groupIndex = groupMap.get(groupKey);
      if (groupIndex == null) {
        groupIndex = groupRows.length;
        groupMap.set(groupKey, groupIndex);
        groupRows.push({ planIndex, targetOrdinal, count: 0 });
      }
      groupIndices[rowIndex] = groupIndex;
      groupRows[groupIndex].count += 1;
      rowIndex += 1;
    }
  }
  return finalizeNavigationPlan(new Int32Array(values), Uint32Array.from(groupIndices), groupRows);
}

export function cpuSelectFrontierNavigationRows(plan, { planCount = null } = {}) {
  if (!plan || plan.schema !== WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA || plan.stride !== FRONTIER_NAVIGATION_PLAN_STRIDE || !(plan.values instanceof Int32Array)) throw new TypeError('navigation plan is invalid');
  let inferredPlanCount = 0;
  for (let index = 0; index < plan.rowCount; index += 1) inferredPlanCount = Math.max(inferredPlanCount, rowAt(plan, index).planIndex + 1);
  const count = planCount == null ? inferredPlanCount : uint(planCount, 'planCount', 0);
  const records = [];
  for (let index = 0; index < plan.rowCount; index += 1) {
    const row = rowAt(plan, index);
    if (row.planIndex >= count) throw new RangeError(`navigation row ${index} exceeds planCount`);
    records.push({ planIndex: row.planIndex, targetOrdinal: row.targetOrdinal, pieceId: row.pieceId, originX: row.originX, originY: row.originY, inputOrdinal: index });
  }
  const recordOracle = cpuSelectFrontierRecordIndices(records, { planCount: count });
  const selectedRows = recordOracle.selectedRecordIndices;
  const groupCount = new Set(records.map(record => `${record.planIndex}:${record.targetOrdinal}`)).size;
  return Object.freeze({ schema: WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA, status: 'completed', backend: 'cpu-oracle', parity: 'oracle', rowCount: plan.rowCount, selectedCount: selectedRows.length, selectedRows: Uint32Array.from(selectedRows), planCount: count, groupCount, inputDigest: plan.inputDigest, recordInputDigest: recordOracle.inputDigest, recordProtocol: recordOracle.schema });
}

async function runGpu(device, plan, planCount, shaderSource) {
  const usage = globalThis.GPUBufferUsage, mapMode = globalThis.GPUMapMode;
  const rowBytes = Math.max(4, plan.values.byteLength), rowCountBytes = Math.max(4, plan.rowCount * 4), groupBytes = Math.max(4, plan.groupValues.byteLength), planCountBytes = Math.max(4, planCount * 4), paramsBytes = 16;
  const rowsBuffer = device.createBuffer({ size: rowBytes, usage: usage.STORAGE | usage.COPY_DST });
  const rowGroupsBuffer = device.createBuffer({ size: rowCountBytes, usage: usage.STORAGE | usage.COPY_DST });
  const groupsBuffer = device.createBuffer({ size: groupBytes, usage: usage.STORAGE | usage.COPY_DST });
  const bestGroupsBuffer = device.createBuffer({ size: planCountBytes, usage: usage.STORAGE });
  const selectedBuffer = device.createBuffer({ size: rowCountBytes, usage: usage.STORAGE | usage.COPY_SRC });
  const paramsBuffer = device.createBuffer({ size: paramsBytes, usage: usage.UNIFORM | usage.COPY_DST });
  const selectedReadback = device.createBuffer({ size: rowCountBytes, usage: usage.MAP_READ | usage.COPY_DST });
  try {
    device.queue.writeBuffer(rowsBuffer, 0, plan.values);
    device.queue.writeBuffer(rowGroupsBuffer, 0, plan.groupIndices);
    device.queue.writeBuffer(groupsBuffer, 0, plan.groupValues);
    device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([plan.rowCount, planCount, plan.groupCount, 0]));
    const module = device.createShaderModule({ code: shaderSource });
    const choosePipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'choose' } });
    const chooseGroup = device.createBindGroup({ layout: choosePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: rowsBuffer } }, { binding: 1, resource: { buffer: rowGroupsBuffer } }, { binding: 2, resource: { buffer: groupsBuffer } }, { binding: 3, resource: { buffer: bestGroupsBuffer } }, { binding: 4, resource: { buffer: paramsBuffer } }] });
    const selectPipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'select' } });
    const selectGroup = device.createBindGroup({ layout: selectPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: rowsBuffer } }, { binding: 1, resource: { buffer: rowGroupsBuffer } }, { binding: 2, resource: { buffer: bestGroupsBuffer } }, { binding: 3, resource: { buffer: selectedBuffer } }, { binding: 4, resource: { buffer: paramsBuffer } }] });
    const encoder = device.createCommandEncoder(), choosePass = encoder.beginComputePass();
    choosePass.setPipeline(choosePipeline); choosePass.setBindGroup(0, chooseGroup); choosePass.dispatchWorkgroups(Math.ceil(planCount / FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE)); choosePass.end();
    const selectPass = encoder.beginComputePass(); selectPass.setPipeline(selectPipeline); selectPass.setBindGroup(0, selectGroup); selectPass.dispatchWorkgroups(Math.ceil(plan.rowCount / FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE)); selectPass.end();
    encoder.copyBufferToBuffer(selectedBuffer, 0, selectedReadback, 0, rowCountBytes); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    await selectedReadback.mapAsync(mapMode.READ); const selectedValues = new Uint32Array(selectedReadback.getMappedRange().slice(0, rowCountBytes)); selectedReadback.unmap();
    return Array.from(selectedValues).flatMap((value, index) => value ? [index] : []);
  } finally { for (const buffer of [rowsBuffer, rowGroupsBuffer, groupsBuffer, bestGroupsBuffer, selectedBuffer, paramsBuffer, selectedReadback]) buffer.destroy(); }
}

function nextCapacity(required) {
  let capacity = 1;
  while (capacity < required) capacity *= 2;
  return capacity;
}

function abortError() {
  const error = new Error('webgpu-navigation-cancelled');
  error.name = 'AbortError';
  return error;
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function createPersistentGpuNavigationRunner(device, shaderSource) {
  const usage = globalThis.GPUBufferUsage, mapMode = globalThis.GPUMapMode;
  let resources = null, dispatchCount = 0, generation = 0, lost = false, queue = Promise.resolve();
  const dispose = bundle => { if (bundle) for (const buffer of Object.values(bundle.buffers)) buffer.destroy(); };
  const destroy = () => { dispose(resources); resources = null; };
  if (device?.lost && typeof device.lost.then === 'function') device.lost.then(() => { lost = true; destroy(); }).catch(() => { lost = true; destroy(); });
  const ensure = (rowCount, planCount, groupCount) => {
    const rowCapacity = nextCapacity(Math.max(1, rowCount)), planCapacity = nextCapacity(Math.max(1, planCount)), groupCapacity = nextCapacity(Math.max(1, groupCount));
    if (resources && resources.rowCapacity >= rowCapacity && resources.planCapacity >= planCapacity && resources.groupCapacity >= groupCapacity) return resources;
    const rowBytes = rowCapacity * FRONTIER_NAVIGATION_PLAN_STRIDE * 4, rowCountBytes = rowCapacity * 4, groupBytes = groupCapacity * FRONTIER_NAVIGATION_GROUP_STRIDE * 4, planCountBytes = planCapacity * 4;
    let buffers = null;
    try {
      buffers = {
        rows: device.createBuffer({ size: rowBytes, usage: usage.STORAGE | usage.COPY_DST }),
        rowGroups: device.createBuffer({ size: rowCountBytes, usage: usage.STORAGE | usage.COPY_DST }),
        groups: device.createBuffer({ size: groupBytes, usage: usage.STORAGE | usage.COPY_DST }),
        bestGroups: device.createBuffer({ size: planCountBytes, usage: usage.STORAGE }),
        selected: device.createBuffer({ size: rowCountBytes, usage: usage.STORAGE | usage.COPY_SRC }),
        params: device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST }),
        selectedReadback: device.createBuffer({ size: rowCountBytes, usage: usage.MAP_READ | usage.COPY_DST }),
      };
      const module = device.createShaderModule({ code: shaderSource });
      const choosePipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'choose' } });
      const chooseGroup = device.createBindGroup({ layout: choosePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buffers.rows } }, { binding: 1, resource: { buffer: buffers.rowGroups } }, { binding: 2, resource: { buffer: buffers.groups } }, { binding: 3, resource: { buffer: buffers.bestGroups } }, { binding: 4, resource: { buffer: buffers.params } }] });
      const selectPipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'select' } });
      const selectGroup = device.createBindGroup({ layout: selectPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buffers.rows } }, { binding: 1, resource: { buffer: buffers.rowGroups } }, { binding: 2, resource: { buffer: buffers.bestGroups } }, { binding: 3, resource: { buffer: buffers.selected } }, { binding: 4, resource: { buffer: buffers.params } }] });
      const previous = resources;
      resources = { buffers, choosePipeline, chooseGroup, selectPipeline, selectGroup, rowCapacity, planCapacity, groupCapacity };
      dispose(previous);
    } catch (error) { dispose({ buffers }); throw error; }
    return resources;
  };
  async function runExclusive(plan, planCount, signal) {
    assertNotAborted(signal);
    if (lost) throw new Error('webgpu-device-lost');
    const current = ensure(plan.rowCount, planCount, plan.groupCount), { buffers } = current, rowCountBytes = Math.max(4, plan.rowCount * 4), runGeneration = ++generation;
    device.queue.writeBuffer(buffers.rows, 0, plan.values); device.queue.writeBuffer(buffers.rowGroups, 0, plan.groupIndices); device.queue.writeBuffer(buffers.groups, 0, plan.groupValues); device.queue.writeBuffer(buffers.params, 0, new Uint32Array([plan.rowCount, planCount, plan.groupCount, 0]));
    assertNotAborted(signal);
    const encoder = device.createCommandEncoder(), choosePass = encoder.beginComputePass();
    choosePass.setPipeline(current.choosePipeline); choosePass.setBindGroup(0, current.chooseGroup); choosePass.dispatchWorkgroups(Math.ceil(planCount / FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE)); choosePass.end();
    const selectPass = encoder.beginComputePass(); selectPass.setPipeline(current.selectPipeline); selectPass.setBindGroup(0, current.selectGroup); selectPass.dispatchWorkgroups(Math.ceil(plan.rowCount / FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE)); selectPass.end();
    encoder.copyBufferToBuffer(buffers.selected, 0, buffers.selectedReadback, 0, rowCountBytes); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone(); assertNotAborted(signal); if (lost) throw new Error('webgpu-device-lost');
    await buffers.selectedReadback.mapAsync(mapMode.READ); assertNotAborted(signal); const selectedValues = new Uint32Array(buffers.selectedReadback.getMappedRange().slice(0, rowCountBytes)); buffers.selectedReadback.unmap(); if (runGeneration !== generation) throw new Error('webgpu-navigation-generation-mismatch');
    dispatchCount += 1;
    return { selectedRows: Array.from(selectedValues).flatMap((value, index) => value ? [index] : []), inputDigest: plan.inputDigest, generation: runGeneration, dispatch: 'webgpu-navigation-plan-resident', persistent: true, dispatchCount, bufferCapacity: { rows: current.rowCapacity, plans: current.planCapacity, groups: current.groupCapacity } };
  }
  return Object.freeze({
    reset: destroy,
    run(plan, planCount, { signal } = {}) { const task = queue.then(() => runExclusive(plan, planCount, signal)); queue = task.catch(() => {}); return task; },
  });
}

function normalizeResidentEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError('resident navigation entries must be a non-empty array');
  return entries.map((entry, index) => {
    const handle = entry?.residentHandle || entry;
    const compatibleSchema = handle?.schema === 'tdotdh.webgpu-frontier-candidate-records-resident.v0'
      || handle?.schema === 'tdotdh.webgpu-frontier-target-records.v0';
    if (!compatibleSchema) throw new TypeError(`resident navigation entry ${index} has an invalid candidate-record handle`);
    if (!Number.isSafeInteger(handle.recordCount) || handle.recordCount < 0) throw new RangeError(`resident navigation entry ${index} has an invalid recordCount`);
    if (!handle.recordsBuffer || typeof handle.recordsBuffer !== 'object') throw new TypeError(`resident navigation entry ${index} has no recordsBuffer`);
    if (handle.recordsOffsetBytes !== undefined && (!Number.isSafeInteger(handle.recordsOffsetBytes) || handle.recordsOffsetBytes < 0 || handle.recordsOffsetBytes % 4)) throw new RangeError(`resident navigation entry ${index} has an invalid recordsOffsetBytes`);
    if (handle.recordStrideBytes !== undefined && handle.recordStrideBytes !== 5 * 4) throw new RangeError(`resident navigation entry ${index} has an incompatible recordStrideBytes`);
    if (handle.validityBuffer !== undefined && (!handle.validityBuffer || typeof handle.validityBuffer !== 'object')) throw new TypeError(`resident navigation entry ${index} has an invalid validityBuffer`);
    if (handle.validityOffsetBytes !== undefined && (!Number.isSafeInteger(handle.validityOffsetBytes) || handle.validityOffsetBytes < 0 || handle.validityOffsetBytes % 4)) throw new RangeError(`resident navigation entry ${index} has an invalid validityOffsetBytes`);
    if (handle.validityStrideBytes !== undefined && handle.validityStrideBytes !== 4) throw new RangeError(`resident navigation entry ${index} has an incompatible validityStrideBytes`);
    const piecePlans = Array.from(entry?.piecePlans || handle.piecePlans || []);
    if (!piecePlans.length && handle.recordCount) throw new TypeError(`resident navigation entry ${index} must provide piecePlans`);
    for (const [planIndex, value] of piecePlans.entries()) uint(value, 'piecePlans', planIndex);
    return Object.freeze({ handle, piecePlans: Object.freeze(piecePlans.map(value => uint(value, 'piecePlans', index))), expectedRows: Object.freeze(Array.from(entry?.expectedRows || [])) });
  });
}

function residentInputDigest(entries) {
  const values = [];
  for (const entry of entries) values.push(entry.handle.recordCount, ...entry.piecePlans);
  return digest(values);
}

function createPersistentGpuResidentNavigationRunner(device, shaderSource) {
  const usage = globalThis.GPUBufferUsage, mapMode = globalThis.GPUMapMode;
  let resources = null, dispatchCount = 0, queue = Promise.resolve(), lost = false;
  const dispose = bundle => { if (bundle) for (const buffer of Object.values(bundle.buffers)) buffer.destroy(); };
  const destroy = () => { dispose(resources); resources = null; };
  if (device?.lost && typeof device.lost.then === 'function') device.lost.then(() => { lost = true; destroy(); }).catch(() => { lost = true; destroy(); });
  const ensure = (recordCount, handleCount, piecePlanCount, planCount) => {
    const recordCapacity = nextCapacity(Math.max(1, recordCount)), handleCapacity = nextCapacity(Math.max(1, handleCount)), piecePlanCapacity = nextCapacity(Math.max(1, piecePlanCount)), planTargetCapacity = nextCapacity(Math.max(1, planCount)), groupCapacity = nextCapacity(Math.max(1, Math.ceil(recordCount / FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE)));
    if (resources && resources.recordCapacity >= recordCapacity && resources.handleCapacity >= handleCapacity && resources.piecePlanCapacity >= piecePlanCapacity && resources.planTargetCapacity >= planTargetCapacity && resources.groupCapacity >= groupCapacity) return resources;
    const recordsBytes = recordCapacity * FRONTIER_NAVIGATION_RESIDENT_RECORD_STRIDE * 4, compactedRecordsBytes = recordCapacity * FRONTIER_NAVIGATION_RESIDENT_COMPACTED_STRIDE * 4, metaBytes = handleCapacity * FRONTIER_NAVIGATION_RESIDENT_META_STRIDE * 4, piecePlanBytes = piecePlanCapacity * 4, recordCountBytes = recordCapacity * 4, groupBytes = groupCapacity * 4;
    const maxStorageBufferBindingSize = device.limits?.maxStorageBufferBindingSize;
    if (Number.isFinite(maxStorageBufferBindingSize) && recordsBytes > maxStorageBufferBindingSize) throw new RangeError(`resident navigation requires ${recordsBytes} bytes but device allows ${maxStorageBufferBindingSize}`);
    let buffers = null;
    try {
      buffers = {
        records: device.createBuffer({ size: recordsBytes, usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC }),
        handleMeta: device.createBuffer({ size: metaBytes, usage: usage.STORAGE | usage.COPY_DST }),
        piecePlans: device.createBuffer({ size: piecePlanBytes, usage: usage.STORAGE | usage.COPY_DST }),
        selected: device.createBuffer({ size: recordCountBytes, usage: usage.STORAGE | usage.COPY_SRC }),
        params: device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST }),
        validity: device.createBuffer({ size: recordCountBytes, usage: usage.STORAGE | usage.COPY_DST }),
        targetCounts: device.createBuffer({ size: planTargetCapacity * FRONTIER_NAVIGATION_RESIDENT_MAX_TARGETS * 4, usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC }),
        prefixes: device.createBuffer({ size: recordCountBytes, usage: usage.STORAGE | usage.COPY_SRC }),
        groupTotals: device.createBuffer({ size: groupBytes, usage: usage.STORAGE | usage.COPY_SRC }),
        groupOffsets: device.createBuffer({ size: groupBytes, usage: usage.STORAGE | usage.COPY_DST }),
        compactedRecords: device.createBuffer({ size: compactedRecordsBytes, usage: usage.STORAGE | usage.COPY_SRC }),
        groupReadback: device.createBuffer({ size: groupBytes, usage: usage.MAP_READ | usage.COPY_DST }),
        compactedReadback: device.createBuffer({ size: compactedRecordsBytes, usage: usage.MAP_READ | usage.COPY_DST }),
      };
      const module = device.createShaderModule({ code: shaderSource });
      const shaderStageCompute = globalThis.GPUShaderStage?.COMPUTE || 4;
      const explicitLayout = typeof device.createBindGroupLayout === 'function' && typeof device.createPipelineLayout === 'function';
      const residentBindGroupLayout = explicitLayout ? device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: shaderStageCompute, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: shaderStageCompute, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: shaderStageCompute, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: shaderStageCompute, buffer: { type: 'storage' } },
        { binding: 4, visibility: shaderStageCompute, buffer: { type: 'uniform' } },
        { binding: 5, visibility: shaderStageCompute, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: shaderStageCompute, buffer: { type: 'storage' } },
      ] }) : null;
      const pipelineLayout = explicitLayout ? device.createPipelineLayout({ bindGroupLayouts: [residentBindGroupLayout] }) : 'auto';
      const countPipeline = device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint: 'countResident' } });
      const selectPipeline = device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint: 'selectResident' } });
      const bindGroup = device.createBindGroup({ layout: residentBindGroupLayout || countPipeline.getBindGroupLayout(0), entries: [0, 1, 2, 3, 4, 5, 6].map((binding, index) => ({ binding, resource: { buffer: [buffers.records, buffers.handleMeta, buffers.piecePlans, buffers.selected, buffers.params, buffers.validity, buffers.targetCounts][index] } })) });
      const scanModule = device.createShaderModule({ code: FRONTIER_NAVIGATION_RESIDENT_SCAN_SHADER });
      const compactModule = device.createShaderModule({ code: FRONTIER_NAVIGATION_RESIDENT_COMPACT_SHADER });
      const scanPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: scanModule, entryPoint: 'scanResident' } });
      const compactPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: compactModule, entryPoint: 'compactResident' } });
      const scanParams = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST });
      const scanBindGroup = device.createBindGroup({ layout: scanPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buffers.selected } }, { binding: 1, resource: { buffer: buffers.prefixes } }, { binding: 2, resource: { buffer: buffers.groupTotals } }, { binding: 3, resource: { buffer: scanParams } }] });
      const compactBindGroup = device.createBindGroup({ layout: compactPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buffers.records } }, { binding: 1, resource: { buffer: buffers.selected } }, { binding: 2, resource: { buffer: buffers.prefixes } }, { binding: 3, resource: { buffer: buffers.groupOffsets } }, { binding: 4, resource: { buffer: buffers.compactedRecords } }, { binding: 5, resource: { buffer: scanParams } }] });
      const previous = resources;
      resources = { buffers: { ...buffers, scanParams }, countPipeline, selectPipeline, bindGroup, scanPipeline, compactPipeline, scanBindGroup, compactBindGroup, recordCapacity, handleCapacity, piecePlanCapacity, planTargetCapacity, groupCapacity };
      dispose(previous);
    } catch (error) { dispose({ buffers }); throw error; }
    return resources;
  };
  async function runExclusive(entries, { signal, planCount = 0, captureTargetCounts = false } = {}) {
    const timingStarted = performance.now(), stageTimings = {}, markStage = (name, started) => { stageTimings[name] = Number((performance.now() - started).toFixed(2)); };
    assertNotAborted(signal);
    if (lost) throw new Error('webgpu-device-lost');
    for (const [index, entry] of entries.entries()) {
      if (entry.handle.device && entry.handle.device !== device) throw new TypeError(`resident navigation entry ${index} belongs to another WebGPU device`);
      if (entry.handle.recordsBuffer.size !== undefined && (entry.handle.recordsOffsetBytes || 0) + entry.handle.recordCount * FRONTIER_NAVIGATION_RESIDENT_RECORD_STRIDE * 4 > entry.handle.recordsBuffer.size) throw new RangeError(`resident navigation entry ${index} records exceed source buffer size`);
      if (entry.handle.validityBuffer?.size !== undefined && (entry.handle.validityOffsetBytes || 0) + entry.handle.recordCount * 4 > entry.handle.validityBuffer.size) throw new RangeError(`resident navigation entry ${index} validity exceeds source buffer size`);
    }
    const recordCount = entries.reduce((sum, entry) => sum + entry.handle.recordCount, 0), piecePlanCount = entries.reduce((sum, entry) => sum + entry.piecePlans.length, 0), resolvedPlanCount = Math.max(1, Number(planCount) || 0, ...entries.flatMap(entry => entry.piecePlans).map(value => value + 1)), current = ensure(recordCount, entries.length, piecePlanCount, resolvedPlanCount), { buffers } = current;
    const handleMeta = new Uint32Array(entries.length * FRONTIER_NAVIGATION_RESIDENT_META_STRIDE), piecePlans = new Uint32Array(piecePlanCount), validity = new Uint32Array(recordCount); validity.fill(1); let recordOffset = 0, piecePlanOffset = 0;
    for (const [index, entry] of entries.entries()) {
      const meta = index * FRONTIER_NAVIGATION_RESIDENT_META_STRIDE;
      handleMeta.set([recordOffset, entry.handle.recordCount, piecePlanOffset, entry.piecePlans.length, recordOffset], meta);
      piecePlans.set(entry.piecePlans, piecePlanOffset); recordOffset += entry.handle.recordCount; piecePlanOffset += entry.piecePlans.length;
    }
    device.queue.writeBuffer(buffers.handleMeta, 0, handleMeta); device.queue.writeBuffer(buffers.piecePlans, 0, piecePlans); device.queue.writeBuffer(buffers.validity, 0, validity); device.queue.writeBuffer(buffers.targetCounts, 0, new Uint32Array(current.planTargetCapacity * FRONTIER_NAVIGATION_RESIDENT_MAX_TARGETS)); device.queue.writeBuffer(buffers.params, 0, new Uint32Array([recordCount, entries.length, resolvedPlanCount, 0]));
    let countEncoder = device.createCommandEncoder(); recordOffset = 0;
    for (const entry of entries) {
      if (entry.handle.recordCount) {
        countEncoder.copyBufferToBuffer(entry.handle.recordsBuffer, entry.handle.recordsOffsetBytes || 0, buffers.records, recordOffset * FRONTIER_NAVIGATION_RESIDENT_RECORD_STRIDE * 4, entry.handle.recordCount * FRONTIER_NAVIGATION_RESIDENT_RECORD_STRIDE * 4);
        if (entry.handle.validityBuffer) countEncoder.copyBufferToBuffer(entry.handle.validityBuffer, entry.handle.validityOffsetBytes || 0, buffers.validity, recordOffset * 4, entry.handle.recordCount * 4);
      }
      recordOffset += entry.handle.recordCount;
    }
    assertNotAborted(signal);
    const countPass = countEncoder.beginComputePass(); countPass.setPipeline(current.countPipeline); countPass.setBindGroup(0, current.bindGroup); countPass.dispatchWorkgroups(Math.ceil(recordCount / FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE)); countPass.end();
    const countStarted = performance.now(); device.queue.submit([countEncoder.finish()]); await device.queue.onSubmittedWorkDone(); markStage('countAndUpload', countStarted); assertNotAborted(signal); if (lost) throw new Error('webgpu-device-lost');
    let targetCounts = null;
    if (captureTargetCounts) {
      const targetCountBytes = Math.max(4, resolvedPlanCount * FRONTIER_NAVIGATION_RESIDENT_MAX_TARGETS * 4);
      if (!buffers.targetCountsReadback || buffers.targetCountsReadback.size < targetCountBytes) { buffers.targetCountsReadback?.destroy?.(); buffers.targetCountsReadback = device.createBuffer({ size: targetCountBytes, usage: usage.MAP_READ | usage.COPY_DST }); }
      const targetCountStarted = performance.now(); const countReadbackEncoder = device.createCommandEncoder(); countReadbackEncoder.copyBufferToBuffer(buffers.targetCounts, 0, buffers.targetCountsReadback, 0, targetCountBytes); device.queue.submit([countReadbackEncoder.finish()]); await device.queue.onSubmittedWorkDone(); assertNotAborted(signal);
      await buffers.targetCountsReadback.mapAsync(mapMode.READ); assertNotAborted(signal); targetCounts = Array.from(new Uint32Array(buffers.targetCountsReadback.getMappedRange().slice(0, targetCountBytes))); buffers.targetCountsReadback.unmap(); markStage('targetCountsReadback', targetCountStarted);
    }
    const groupCount = Math.ceil(recordCount / FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE);
    device.queue.writeBuffer(buffers.scanParams, 0, new Uint32Array([recordCount, groupCount, 0, 0]));
    const selectAndScanEncoder = device.createCommandEncoder();
    const selectPass = selectAndScanEncoder.beginComputePass(); selectPass.setPipeline(current.selectPipeline); selectPass.setBindGroup(0, current.bindGroup); selectPass.dispatchWorkgroups(Math.ceil(recordCount / FRONTIER_NAVIGATION_PLAN_WORKGROUP_SIZE)); selectPass.end();
    const scanPass = selectAndScanEncoder.beginComputePass(); scanPass.setPipeline(current.scanPipeline); scanPass.setBindGroup(0, current.scanBindGroup); scanPass.dispatchWorkgroups(groupCount); scanPass.end();
    const selectScanStarted = performance.now(); selectAndScanEncoder.copyBufferToBuffer(buffers.groupTotals, 0, buffers.groupReadback, 0, Math.max(4, groupCount * 4)); device.queue.submit([selectAndScanEncoder.finish()]); await device.queue.onSubmittedWorkDone(); assertNotAborted(signal); if (lost) throw new Error('webgpu-device-lost');
    await buffers.groupReadback.mapAsync(mapMode.READ); assertNotAborted(signal); const groupTotals = Array.from(new Uint32Array(buffers.groupReadback.getMappedRange().slice(0, Math.max(4, groupCount * 4)))); buffers.groupReadback.unmap(); markStage('selectScanReadback', selectScanStarted); const groupOffsets = new Uint32Array(groupCount); let selectedCount = 0; for (let index = 0; index < groupCount; index += 1) { groupOffsets[index] = selectedCount; selectedCount += groupTotals[index] || 0; }
    device.queue.writeBuffer(buffers.groupOffsets, 0, groupOffsets); device.queue.writeBuffer(buffers.scanParams, 0, new Uint32Array([recordCount, groupCount, 0, 0]));
    const compactStarted = performance.now(); const compactEncoder = device.createCommandEncoder(), compactPass = compactEncoder.beginComputePass(); compactPass.setPipeline(current.compactPipeline); compactPass.setBindGroup(0, current.compactBindGroup); compactPass.dispatchWorkgroups(groupCount); compactPass.end(); compactEncoder.copyBufferToBuffer(buffers.compactedRecords, 0, buffers.compactedReadback, 0, Math.max(4, selectedCount * FRONTIER_NAVIGATION_RESIDENT_COMPACTED_STRIDE * 4)); device.queue.submit([compactEncoder.finish()]); await device.queue.onSubmittedWorkDone(); assertNotAborted(signal); if (lost) throw new Error('webgpu-device-lost');
    const compactedBytes = Math.max(4, selectedCount * FRONTIER_NAVIGATION_RESIDENT_COMPACTED_STRIDE * 4); let rawCompactedRecords = new Int32Array(); if (selectedCount) { await buffers.compactedReadback.mapAsync(mapMode.READ); assertNotAborted(signal); rawCompactedRecords = new Int32Array(buffers.compactedReadback.getMappedRange().slice(0, compactedBytes)); buffers.compactedReadback.unmap(); } markStage('compactReadback', compactStarted); dispatchCount += 1;
    const entryOffsets = []; let offset = 0; for (const entry of entries) { entryOffsets.push(offset); offset += entry.handle.recordCount; }
    const selectedRows = selectedCount > 0 && rawCompactedRecords.length >= selectedCount * FRONTIER_NAVIGATION_RESIDENT_COMPACTED_STRIDE ? Array.from({ length: selectedCount }, (_, index) => rawCompactedRecords[index * FRONTIER_NAVIGATION_RESIDENT_COMPACTED_STRIDE]) : [], selectedRecords = selectedCount > 0 && rawCompactedRecords.length >= selectedCount * FRONTIER_NAVIGATION_RESIDENT_COMPACTED_STRIDE ? selectedRows.map((rowIndex, selectedIndex) => { let entryIndex = 0; while (entryIndex + 1 < entryOffsets.length && rowIndex >= entryOffsets[entryIndex + 1]) entryIndex += 1; const base = selectedIndex * FRONTIER_NAVIGATION_RESIDENT_COMPACTED_STRIDE + 1, entry = entries[entryIndex], batchIndex = rawCompactedRecords[base], metadata = entry.handle.itemMetadata?.[batchIndex], targetOrdinal = rawCompactedRecords[base + 1], sourceIndex = rawCompactedRecords[base + 4], pieceCount = Number(metadata?.pieceCount) || 0, candidateIndex = pieceCount ? targetOrdinal * pieceCount + sourceIndex : sourceIndex; return { rowIndex, entryIndex, pieceId: metadata?.pieceId, targetOrdinal, originX: rawCompactedRecords[base + 2], originY: rawCompactedRecords[base + 3], candidateIndex }; }) : [];
    markStage('decode', timingStarted); return { selectedRows, selectedRecords, residentDiagnostics: { rawRecordSample: Object.freeze(Array.from(rawCompactedRecords.slice(0, 25))), selectedRowSample: Object.freeze(selectedRows.slice(0, 25)), ...(targetCounts ? { targetCounts: Object.freeze(targetCounts) } : {}) }, stageTimings: Object.freeze(stageTimings), dispatch: 'webgpu-navigation-resident-record-compaction', persistent: true, dispatchCount, bufferCapacity: { records: current.recordCapacity, handles: current.handleCapacity, piecePlans: current.piecePlanCapacity, groups: current.groupCapacity } };
  }
  return Object.freeze({ reset: destroy, run(entries, options = {}) { const task = queue.then(() => runExclusive(entries, options)); queue = task.catch(() => {}); return task; } });
}

export function createWebGpuFrontierNavigationScheduler({ gpu = globalThis.navigator?.gpu, requiredLimits = { maxStorageBufferBindingSize: 262144 }, shaderSource = FRONTIER_NAVIGATION_PLAN_SHADER, deviceCache = createWebGpuDeviceCache({ gpu }), accelerator = null, persistent = true } = {}) {
  let availabilityPromise = null;
  let persistentRunner = null;
  let residentRunner = null;
  const availability = async () => {
    if (!availabilityPromise) availabilityPromise = probeWebGpuCapabilities({ gpu, requiredLimits }).then(probe => probe.adapterAvailable && probe.requiredLimitsSatisfied ? Object.freeze({ schema: WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA, status: 'available', backend: 'webgpu' }) : Object.freeze({ schema: WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA, status: 'unavailable', backend: 'webgpu', reason: probe.adapterAvailable ? 'webgpu-required-limits-unsatisfied' : 'webgpu-adapter-unavailable' }));
    return availabilityPromise;
  };
  async function selectPlan(plan, options = {}) {
      const oracle = cpuSelectFrontierNavigationRows(plan, options);
      if (!plan.rowCount || !oracle.planCount) return Object.freeze(oracle);
      if (typeof accelerator !== 'function') {
        const status = await availability();
        if (status.status !== 'available') return Object.freeze({ ...oracle, status: 'fallback', backend: 'cpu-oracle', reason: status.reason });
      }
      try {
        assertNotAborted(options.signal);
        let result;
        if (typeof accelerator === 'function') result = await accelerator({ plan, oracle });
        else {
          const device = await deviceCache.getDevice();
          if (persistent && !persistentRunner) persistentRunner = createPersistentGpuNavigationRunner(device, shaderSource);
          result = persistentRunner ? { status: 'completed', ...await persistentRunner.run(plan, oracle.planCount, options) } : { status: 'completed', selectedRows: await runGpu(device, plan, oracle.planCount, shaderSource), inputDigest: plan.inputDigest, dispatch: 'webgpu-navigation-plan' };
        }
        const selected = result?.selectedRows instanceof Uint32Array ? result.selectedRows : Uint32Array.from(result?.selectedRows || []);
        if (result?.inputDigest && result.inputDigest !== plan.inputDigest) return Object.freeze({ ...oracle, status: 'rejected', backend: 'cpu-oracle', reason: 'navigation-input-digest-mismatch' });
        if (result?.status !== 'completed' || selected.length !== oracle.selectedRows.length || JSON.stringify(Array.from(selected)) !== JSON.stringify(Array.from(oracle.selectedRows))) return Object.freeze({ ...oracle, status: 'rejected', backend: 'cpu-oracle', reason: 'navigation-oracle-parity-mismatch' });
        return Object.freeze({ ...oracle, status: 'completed', backend: 'webgpu', parity: 'verified', selectedRows: selected, dispatch: result.dispatch || 'navigation-plan', ...(result.persistent ? { persistent: true, bufferCapacity: result.bufferCapacity, dispatchCount: result.dispatchCount } : {}) });
      } catch (error) {
        persistentRunner?.reset(); persistentRunner = null;
        deviceCache.reset();
        return Object.freeze({ ...oracle, status: error?.name === 'AbortError' ? 'cancelled' : 'fallback', backend: 'cpu-oracle', reason: error?.name === 'AbortError' ? 'navigation-cancelled' : `navigation-accelerator-failed:${error?.message || String(error)}` });
      }
  }
  return Object.freeze({
    availability,
    async select(rows, options = {}) { return selectPlan(createWebGpuFrontierNavigationPlan(rows), options); },
    async selectCandidateRecords(entries, options = {}) {
      const plan = createWebGpuFrontierNavigationPlanFromCandidateRecords(entries);
      const result = await selectPlan(plan, options);
      return Object.freeze({ ...result, plan });
    },
    async selectResidentCandidateRecords(entries, { expectedRows = null, planCount = null, signal, captureTargetCounts = false } = {}) {
      const normalized = normalizeResidentEntries(entries), rowCount = normalized.reduce((sum, entry) => sum + entry.handle.recordCount, 0), inputDigest = residentInputDigest(normalized), expectedTargetGroups = expectedRows ? (() => { const groups = new Map(); for (const row of expectedRows) { if (row?.valid === 0) continue; const key = `${row.planIndex}:${row.targetOrdinal}`; groups.set(key, (groups.get(key) || 0) + 1); } return Object.freeze(Array.from(groups, ([key, count]) => { const [planIndex, targetOrdinal] = key.split(':').map(Number); return Object.freeze({ planIndex, targetOrdinal, count }); }).sort((a, b) => a.planIndex - b.planIndex || a.targetOrdinal - b.targetOrdinal)); })() : null;
      const expectedRowIndices = expectedRows ? expectedRows.flatMap((row, index) => row?.valid === 0 ? [] : [index]) : null;
      const expected = expectedRows ? cpuSelectFrontierNavigationRows(createWebGpuFrontierNavigationPlan(expectedRows.filter(row => row?.valid !== 0)), { planCount }) : null;
      const expectedResidentRows = expected ? Uint32Array.from(expected.selectedRows, index => expectedRowIndices[index]) : null;
      const residentTargetOrdinalOverflow = expectedRows?.some(row => row?.valid !== 0 && row.targetOrdinal >= FRONTIER_NAVIGATION_RESIDENT_MAX_TARGETS) || false;
      if (!rowCount) return Object.freeze({ schema: WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA, status: 'not-used', backend: 'webgpu', parity: expected ? 'verified' : 'deferred', rowCount: 0, selectedCount: 0, selectedRows: new Uint32Array(), planCount: planCount || 0, inputDigest, dispatch: 'webgpu-navigation-resident-records' });
      try {
        assertNotAborted(signal);
        if (residentTargetOrdinalOverflow) return Object.freeze({ ...expected, status: 'fallback', backend: 'cpu-oracle', parity: 'oracle', rowCount, selectedCount: expectedResidentRows.length, selectedRows: expectedResidentRows, planCount: expected.planCount, inputDigest, dispatch: 'cpu-oracle-resident-target-cap-fallback', reason: 'resident-target-ordinal-exceeds-cap' });
        let result;
        if (typeof accelerator === 'function') result = await accelerator({ entries: normalized, oracle: expected, inputDigest });
        else {
          const status = await availability();
          if (status.status !== 'available') return Object.freeze({ ...(expected || {}), status: 'fallback', backend: 'cpu-oracle', parity: 'oracle', rowCount, selectedCount: expectedResidentRows?.length || 0, selectedRows: expectedResidentRows || new Uint32Array(), planCount: planCount || 0, inputDigest, reason: status.reason });
          const device = await deviceCache.getDevice();
          if (persistent && !residentRunner) residentRunner = createPersistentGpuResidentNavigationRunner(device, FRONTIER_NAVIGATION_RESIDENT_SHADER);
          result = residentRunner ? await residentRunner.run(normalized, { signal, planCount, captureTargetCounts: Boolean(expected && captureTargetCounts) }) : null;
        }
        const selected = result?.selectedRows instanceof Uint32Array ? result.selectedRows : Uint32Array.from(result?.selectedRows || []);
        const selectedParity = !expected || (selected.length === expectedResidentRows.length && Array.from(selected).every((value, index) => value === expectedResidentRows[index])), selectedRowMismatchIndex = expected && !selectedParity ? Array.from(selected).findIndex((value, index) => value !== expectedResidentRows[index]) : -1;
        const observedRecords = result?.selectedRecords || [], expectedRecords = expected ? Array.from(selected).map(index => expectedRows[index]) : [], recordMismatch = expected && observedRecords.length === expectedRecords.length ? observedRecords.map((record, index) => { const expectedRecord = expectedRecords[index], expectedPieceId = `${expectedRecord?.planIndex}:${expectedRecord?.pieceId}`; return String(record?.pieceId) === expectedPieceId && record?.targetOrdinal === expectedRecord?.targetOrdinal && record?.originX === expectedRecord?.originX && record?.originY === expectedRecord?.originY && record?.candidateIndex === expectedRecord?.candidateIndex ? null : { index, observed: record, expected: expectedRecord }; }).find(Boolean) : null, recordParity = !expected || !observedRecords.length ? true : observedRecords.length !== expectedRecords.length ? false : observedRecords.every((record, index) => {
          const expectedRecord = expectedRecords[index], expectedPieceId = `${expectedRecord?.planIndex}:${expectedRecord?.pieceId}`;
          return String(record?.pieceId) === expectedPieceId && record?.targetOrdinal === expectedRecord?.targetOrdinal && record?.originX === expectedRecord?.originX && record?.originY === expectedRecord?.originY && record?.candidateIndex === expectedRecord?.candidateIndex;
        });
        const observedTargetGroups = result?.residentDiagnostics?.targetCounts ? Object.freeze(result.residentDiagnostics.targetCounts.flatMap((count, index) => count ? [Object.freeze({ planIndex: Math.floor(index / FRONTIER_NAVIGATION_RESIDENT_MAX_TARGETS), targetOrdinal: index % FRONTIER_NAVIGATION_RESIDENT_MAX_TARGETS, count })] : [])) : null;
        const targetGroupSummary = expectedTargetGroups && observedTargetGroups ? (() => { const expectedMap = new Map(expectedTargetGroups.map(group => [`${group.planIndex}:${group.targetOrdinal}`, group.count])), observedMap = new Map(observedTargetGroups.map(group => [`${group.planIndex}:${group.targetOrdinal}`, group.count])), keys = new Set([...expectedMap.keys(), ...observedMap.keys()]), differences = [], focusPlan = Number(recordMismatch?.expected?.planIndex); for (const key of keys) { const expectedCount = expectedMap.get(key) || 0, observedCount = observedMap.get(key) || 0; if (expectedCount !== observedCount && differences.length < 16) { const [planIndex, targetOrdinal] = key.split(':').map(Number); differences.push(Object.freeze({ planIndex, targetOrdinal, expectedCount, observedCount })); } } const focus = Number.isSafeInteger(focusPlan) ? Object.freeze(Array.from(keys).filter(key => Number(key.split(':')[0]) === focusPlan).map(key => { const [planIndex, targetOrdinal] = key.split(':').map(Number); return Object.freeze({ planIndex, targetOrdinal, expectedCount: expectedMap.get(key) || 0, observedCount: observedMap.get(key) || 0 }); })) : Object.freeze([]); return Object.freeze({ expectedGroupCount: expectedMap.size, observedGroupCount: observedMap.size, differenceCount: Array.from(keys).filter(key => (expectedMap.get(key) || 0) !== (observedMap.get(key) || 0)).length, differences: Object.freeze(differences), focus }); })() : null;
        const residentDiagnostics = result?.residentDiagnostics ? (() => { const { targetCounts: _targetCounts, ...diagnosticBase } = result.residentDiagnostics; return Object.freeze({ ...diagnosticBase, ...(targetGroupSummary ? { targetGroupSummary } : {}), ...(expected ? { entryBoundaries: Object.freeze(normalized.map(entry => Object.freeze({ recordCount: entry.handle.recordCount, expectedRowCount: entry.expectedRows.length }))) } : {}) }); })() : result?.residentDiagnostics;
        if (expected && (!selectedParity || !recordParity)) return Object.freeze({ ...expected, status: 'rejected', backend: 'cpu-oracle', selectedRows: expectedResidentRows, selectedCount: expectedResidentRows.length, observedSelectedRows: Object.freeze(Array.from(selected).slice(0, 128)), selectedRowMismatchIndex, observedSelectedRecords: Object.freeze(observedRecords.slice(0, 32).map(record => Object.freeze(record))), expectedSelectedRecords: Object.freeze(expectedRecords.slice(0, 32).map(record => Object.freeze(record))), ...(recordMismatch ? { recordMismatch: Object.freeze(recordMismatch) } : {}), ...(residentDiagnostics ? { residentDiagnostics } : {}), observedRecordCount: observedRecords.length, expectedRecordCount: expectedRecords.length, reason: !selectedParity ? 'resident-navigation-oracle-parity-mismatch' : 'resident-navigation-record-decode-parity-mismatch', rowCount, inputDigest });
        return Object.freeze({ ...(expected || { schema: WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA, rowCount, planCount: planCount || 0 }), status: 'completed', backend: 'webgpu', parity: expected ? 'verified' : 'deferred', rowCount, selectedCount: selected.length, selectedRows: selected, ...(result?.selectedRecords ? { selectedRecords: Object.freeze(result.selectedRecords.map(record => Object.freeze(record))) } : {}), ...(residentDiagnostics ? { residentDiagnostics } : {}), ...(result?.stageTimings ? { stageTimings: Object.freeze({ ...result.stageTimings }) } : {}), inputDigest, dispatch: result?.dispatch || 'webgpu-navigation-resident-records', ...(result?.persistent ? { persistent: true, dispatchCount: result.dispatchCount, bufferCapacity: result.bufferCapacity } : {}) });
      } catch (error) { residentRunner?.reset(); residentRunner = null; deviceCache.reset(); return Object.freeze({ ...(expected || { schema: WEBGPU_FRONTIER_NAVIGATION_PLAN_SCHEMA, rowCount, planCount: planCount || 0, selectedRows: new Uint32Array() }), status: error?.name === 'AbortError' ? 'cancelled' : 'fallback', backend: 'cpu-oracle', parity: expected ? 'oracle' : 'deferred', rowCount, inputDigest, selectedRows: expectedResidentRows || new Uint32Array(), selectedCount: expectedResidentRows?.length || 0, reason: error?.name === 'AbortError' ? 'navigation-cancelled' : `resident-navigation-failed:${error?.message || String(error)}` }); } finally { for (const entry of normalized) entry.handle.release?.(); }
    },
  });
}

export function decodeWebGpuFrontierNavigationRow(plan, index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= plan.rowCount) throw new RangeError('navigation row index is out of bounds');
  return Object.freeze(rowAt(plan, index));
}
