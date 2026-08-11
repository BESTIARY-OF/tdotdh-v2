const PROTOCOL = 'tdotdh.webgpu-frontier-record-navigation.v0';
const VERSION = 0;
const RECORD_FIELDS = Object.freeze(['planIndex', 'targetOrdinal', 'pieceId', 'originX', 'originY', 'inputOrdinal']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertInteger(value, field, index, signed = false) {
  const valid = Number.isSafeInteger(value) && (signed ? value >= -0x80000000 && value <= 0x7fffffff : value >= 0 && value <= 0xffffffff);
  if (!valid) throw new TypeError(`record ${index} field ${field} must be a ${signed ? 'signed' : 'unsigned'} 32-bit integer`);
}

function normalizeRecord(record, index) {
  if (!isPlainObject(record)) throw new TypeError(`record ${index} must be a plain object`);
  const keys = Reflect.ownKeys(record);
  if (keys.length !== RECORD_FIELDS.length || keys.some(key => typeof key !== 'string' || !RECORD_FIELDS.includes(key))) throw new TypeError(`record ${index} has an invalid field set`);
  assertInteger(record.planIndex, 'planIndex', index);
  assertInteger(record.targetOrdinal, 'targetOrdinal', index);
  assertInteger(record.pieceId, 'pieceId', index);
  assertInteger(record.originX, 'originX', index, true);
  assertInteger(record.originY, 'originY', index, true);
  assertInteger(record.inputOrdinal, 'inputOrdinal', index);
  return { planIndex: record.planIndex, targetOrdinal: record.targetOrdinal, pieceId: record.pieceId, originX: record.originX, originY: record.originY, inputOrdinal: record.inputOrdinal };
}

function normalizeRecords(records, capacity = null) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (capacity != null && (!Number.isSafeInteger(capacity) || capacity < 0 || records.length > capacity)) throw new RangeError('records exceed the bounded frontier capacity');
  return records.map(normalizeRecord);
}

function digestRecords(records) {
  let hash = 0x811c9dc5;
  const text = JSON.stringify(records);
  for (const character of text) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 0x01000193); }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function cpuSelectFrontierRecords(records, options = {}) {
  const normalized = normalizeRecords(records, options.capacity);
  const plans = new Map();
  normalized.forEach((record, inputIndex) => {
    const targets = plans.get(record.planIndex) || new Map();
    const group = targets.get(record.targetOrdinal) || [];
    group.push(inputIndex);
    targets.set(record.targetOrdinal, group);
    plans.set(record.planIndex, targets);
  });
  const selections = [...plans.keys()].sort((a, b) => a - b).map(planIndex => {
    const targets = plans.get(planIndex);
    const selected = [...targets.entries()].sort((a, b) => a[1].length - b[1].length || a[0] - b[0])[0];
    return { planIndex, targetOrdinal: selected[0], inputIndices: [...selected[1]], population: selected[1].length };
  });
  const selectedInputIndices = selections.flatMap(selection => selection.inputIndices).sort((a, b) => a - b);
  return { protocol: PROTOCOL, version: VERSION, operation: 'least-populated-target-per-plan', inputDigest: digestRecords(normalized), selectedInputIndices, selectedRecords: selectedInputIndices.map(index => ({ ...normalized[index] })), selections };
}

function webgpuRecordNavigationAvailability({ gpu = globalThis.navigator?.gpu, adapter = null, device = null } = {}) {
  if (!gpu) return { status: 'unavailable', backend: 'cpu-oracle', reason: 'navigator.gpu is not present' };
  if (!adapter || !device) return { status: 'unavailable', backend: 'cpu-oracle', reason: 'WebGPU adapter/device resources are not supplied' };
  return { status: 'available', backend: 'webgpu', parity: 'pending' };
}

function assertSelectionParity(selection, oracle) {
  if (!selection || !Array.isArray(selection.selectedInputIndices) || JSON.stringify(selection.selectedInputIndices) !== JSON.stringify(oracle.selectedInputIndices)) throw new Error('GPU record navigation did not match the CPU oracle');
}

async function selectFrontierRecords(records, { capacity = null, adapter = null, availability = null } = {}) {
  const oracle = cpuSelectFrontierRecords(records, { capacity });
  const status = availability || webgpuRecordNavigationAvailability({ adapter: adapter?.adapter, device: adapter?.device, gpu: adapter?.gpu });
  if (status.status !== 'available' || typeof adapter?.select !== 'function') return { ...oracle, status: 'fallback', backend: 'cpu-oracle', parity: 'oracle', reason: status.reason || 'record-navigation-adapter-unavailable' };
  try {
    const selection = await adapter.select({ protocol: PROTOCOL, version: VERSION, records: normalizeRecords(records, capacity), inputDigest: oracle.inputDigest });
    assertSelectionParity(selection, oracle);
    return { ...oracle, status: 'used', backend: selection.backend || 'webgpu', parity: 'verified', selectedInputIndices: [...selection.selectedInputIndices] };
  } catch (error) {
    return { ...oracle, status: 'fallback', backend: 'cpu-oracle', parity: 'oracle', reason: `record-navigation-parity:${error.message}` };
  }
}

export { PROTOCOL, RECORD_FIELDS, VERSION, cpuSelectFrontierRecords, digestRecords, normalizeRecord, normalizeRecords, selectFrontierRecords, webgpuRecordNavigationAvailability };
