export const WEBGPU_FRONTIER_RECORD_NAVIGATION_SCHEMA = 'tdotdh.webgpu-frontier-record-navigation.v0';
export const FRONTIER_RECORD_NAVIGATION_STRIDE = 6;
// This is a protocol safety ceiling, not the device batch size. The scheduler
// still sizes GPU buffers from the actual device limits; keeping this ceiling
// above a realistic breadth layer prevents the CPU oracle from rejecting a
// valid batch before the GPU selector can see it.
export const MAX_FRONTIER_RECORD_NAVIGATION_RECORDS = 65536;

const RECORD_FIELDS = Object.freeze(['planIndex', 'targetOrdinal', 'pieceId', 'originX', 'originY', 'inputOrdinal']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertInteger(value, field, index, { signed = false } = {}) {
  const valid = Number.isSafeInteger(value) && (signed
    ? value >= -0x80000000 && value <= 0x7fffffff
    : value >= 0 && value <= 0xffffffff);
  if (!valid) throw new TypeError(`record ${index}.${field} must be a ${signed ? 'signed' : 'unsigned'} 32-bit integer`);
}

export function normalizeFrontierRecord(record, index = 0) {
  if (!isPlainObject(record)) throw new TypeError(`record ${index} must be a plain object`);
  const keys = Reflect.ownKeys(record);
  if (keys.length !== RECORD_FIELDS.length || keys.some(key => typeof key !== 'string' || !RECORD_FIELDS.includes(key))) {
    throw new TypeError(`record ${index} has an invalid field set`);
  }
  assertInteger(record.planIndex, 'planIndex', index);
  assertInteger(record.targetOrdinal, 'targetOrdinal', index);
  assertInteger(record.pieceId, 'pieceId', index);
  assertInteger(record.originX, 'originX', index, { signed: true });
  assertInteger(record.originY, 'originY', index, { signed: true });
  assertInteger(record.inputOrdinal, 'inputOrdinal', index);
  return Object.freeze({
    planIndex: record.planIndex,
    targetOrdinal: record.targetOrdinal,
    pieceId: record.pieceId,
    originX: record.originX,
    originY: record.originY,
    inputOrdinal: record.inputOrdinal,
  });
}

export function normalizeFrontierRecords(records, { capacity = MAX_FRONTIER_RECORD_NAVIGATION_RECORDS } = {}) {
  if (!Array.isArray(records)) throw new TypeError('frontier records must be an array');
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > MAX_FRONTIER_RECORD_NAVIGATION_RECORDS) {
    throw new RangeError(`frontier record capacity must be 0-${MAX_FRONTIER_RECORD_NAVIGATION_RECORDS}`);
  }
  if (records.length > capacity) throw new RangeError('frontier records exceed the bounded navigation capacity');
  return Object.freeze(records.map(normalizeFrontierRecord));
}

function digestPacked(values) {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= Number(value) >>> 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function packFrontierRecords(records, options = {}) {
  const normalized = normalizeFrontierRecords(records, options);
  const values = new Int32Array(normalized.length * FRONTIER_RECORD_NAVIGATION_STRIDE);
  normalized.forEach((record, index) => {
    values.set([
      record.planIndex,
      record.targetOrdinal,
      record.pieceId,
      record.originX,
      record.originY,
      record.inputOrdinal,
    ], index * FRONTIER_RECORD_NAVIGATION_STRIDE);
  });
  return Object.freeze({
    schema: WEBGPU_FRONTIER_RECORD_NAVIGATION_SCHEMA,
    stride: FRONTIER_RECORD_NAVIGATION_STRIDE,
    recordCount: normalized.length,
    values,
    records: normalized,
    inputDigest: digestPacked(values),
  });
}

function normalizePlanCount(planCount, records) {
  if (planCount == null) return records.reduce((count, record) => Math.max(count, record.planIndex + 1), 0);
  if (!Number.isSafeInteger(planCount) || planCount < 0) throw new TypeError('planCount must be a non-negative safe integer');
  if (records.some(record => record.planIndex >= planCount)) throw new RangeError('frontier record planIndex exceeds planCount');
  return planCount;
}

function sameIndices(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeSelectedRecordIndices(selectedRecordIndices, recordCount) {
  if (!(selectedRecordIndices instanceof Uint32Array) && !Array.isArray(selectedRecordIndices)) {
    throw new TypeError('adapter selectedRecordIndices must be an array or Uint32Array');
  }
  const result = Uint32Array.from(selectedRecordIndices);
  const seen = new Set();
  for (const index of result) {
    if (index >= recordCount) throw new RangeError('adapter selectedRecordIndices contains an out-of-range index');
    if (seen.has(index)) throw new RangeError('adapter selectedRecordIndices contains a duplicate index');
    seen.add(index);
  }
  return result;
}

/**
 * CPU oracle for the existing navigation rule.
 *
 * The selected indices are returned in stable flat-input order. The target
 * group chosen for each plan is the least populated one; equal populations
 * choose the lowest target ordinal.
 */
export function cpuSelectFrontierRecordIndices(records, { capacity = MAX_FRONTIER_RECORD_NAVIGATION_RECORDS, planCount = null } = {}) {
  const packed = packFrontierRecords(records, { capacity });
  const count = normalizePlanCount(planCount, packed.records);
  const plans = new Map();
  packed.records.forEach((record, inputIndex) => {
    const targets = plans.get(record.planIndex) || new Map();
    const indices = targets.get(record.targetOrdinal) || [];
    indices.push(inputIndex);
    targets.set(record.targetOrdinal, indices);
    plans.set(record.planIndex, targets);
  });

  const selections = [...plans.keys()].sort((left, right) => left - right).map(planIndex => {
    const targets = plans.get(planIndex);
    let selected = null;
    for (const [targetOrdinal, indices] of targets.entries()) {
      if (!selected || indices.length < selected.indices.length || (indices.length === selected.indices.length && targetOrdinal < selected.targetOrdinal)) {
        selected = { planIndex, targetOrdinal, indices };
      }
    }
    return Object.freeze({
      planIndex,
      targetOrdinal: selected.targetOrdinal,
      population: selected.indices.length,
      recordIndices: Object.freeze([...selected.indices]),
    });
  });

  const selectedRecordIndices = Uint32Array.from(selections.flatMap(selection => selection.recordIndices).sort((left, right) => left - right));
  return Object.freeze({
    schema: WEBGPU_FRONTIER_RECORD_NAVIGATION_SCHEMA,
    status: 'completed',
    backend: 'cpu-oracle',
    parity: 'oracle',
    operation: 'least-populated-target-per-plan',
    planCount: count,
    recordCount: packed.recordCount,
    stride: packed.stride,
    inputDigest: packed.inputDigest,
    packedRecords: packed.values,
    selectedRecordIndices,
    selectedRecords: Object.freeze(Array.from(selectedRecordIndices, index => packed.records[index])),
    selections: Object.freeze(selections),
  });
}

function fallback(oracle, reason) {
  return Object.freeze({ ...oracle, status: 'fallback', backend: 'cpu-oracle', parity: 'oracle', reason });
}

/**
 * CPU-oracle-first adapter seam. A future GPU implementation receives only
 * the packed record buffer and returns selected record indices; it never owns
 * placement objects or canonical arrangement semantics.
 */
export function createFrontierRecordNavigationAdapter({ accelerator = null, capacity = MAX_FRONTIER_RECORD_NAVIGATION_RECORDS } = {}) {
  return Object.freeze({
    async select(records, { planCount = null } = {}) {
      const oracle = cpuSelectFrontierRecordIndices(records, { capacity, planCount });
      if (typeof accelerator !== 'function') return fallback(oracle, 'record-navigation-accelerator-unavailable');
      try {
        const result = await accelerator({
          schema: WEBGPU_FRONTIER_RECORD_NAVIGATION_SCHEMA,
          stride: oracle.stride,
          recordCount: oracle.recordCount,
          planCount: oracle.planCount,
          packedRecords: oracle.packedRecords,
          inputDigest: oracle.inputDigest,
        });
        const selectedRecordIndices = normalizeSelectedRecordIndices(result?.selectedRecordIndices, oracle.recordCount);
        if (!sameIndices(Array.from(selectedRecordIndices), Array.from(oracle.selectedRecordIndices))) {
          return fallback(oracle, 'record-navigation-oracle-parity-mismatch');
        }
        return Object.freeze({
          ...oracle,
          status: 'used',
          backend: result?.backend || 'gpu-adapter',
          parity: 'verified',
          selectedRecordIndices,
          ...(result?.dispatch ? { dispatch: result.dispatch } : {}),
        });
      } catch (error) {
        return fallback(oracle, `record-navigation-accelerator-failed:${error?.message || String(error)}`);
      }
    },
  });
}

export { RECORD_FIELDS };
