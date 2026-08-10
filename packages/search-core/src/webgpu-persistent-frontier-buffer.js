export const WEBGPU_PERSISTENT_FRONTIER_BUFFER_SCHEMA = 'tdotdh.webgpu-persistent-frontier-buffer.v0';
export const FRONTIER_COMPACTION_OPERATION = 'stable-first-key-compaction';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${label} must be a positive safe integer`);
  return number;
}
function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
  return number;
}
function normalizeEntry(entry, index) {
  if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string' || !entry.key) throw new TypeError(`frontier entry ${index} requires a key`);
  if (!Object.prototype.hasOwnProperty.call(entry, 'payload')) throw new TypeError(`frontier entry ${index} requires a payload`);
  return Object.freeze({ key: entry.key, payload: clone(entry.payload) });
}
function normalizeEntries(entries) {
  if (!Array.isArray(entries)) throw new TypeError('frontier entries must be an array');
  return entries.map(normalizeEntry);
}
function publicEntries(entries) { return entries.map(entry => ({ key: entry.key, payload: clone(entry.payload) })); }
function digest(entries) {
  const text = JSON.stringify(entries);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function equalEntries(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function webGpuStatus(runtime = globalThis) {
  const gpu = runtime?.navigator?.gpu;
  return gpu ? { status: 'available', backend: 'webgpu', ownership: 'external-executor-required' } : { status: 'unavailable', backend: 'webgpu', reason: 'navigator.gpu-unavailable' };
}

export class PersistentFrontierBufferError extends Error {
  constructor(code, message) { super(message); this.name = 'PersistentFrontierBufferError'; this.code = code; }
}

export class PersistentFrontierBuffer {
  constructor({ capacity, entries = [] } = {}) {
    this.capacity = positiveInteger(capacity, 'frontier capacity');
    this.entriesValue = normalizeEntries(entries);
    if (this.entriesValue.length > this.capacity) throw new PersistentFrontierBufferError('CAPACITY_EXCEEDED', 'initial frontier exceeds capacity');
    this.refreshDigest();
  }

  refreshDigest() { this.payloadDigest = digest(this.entriesValue); }
  get size() { return this.entriesValue.length; }
  entries() { return publicEntries(this.entriesValue); }

  cursorAt(offset = 0) {
    const normalized = nonNegativeInteger(offset, 'frontier cursor offset');
    if (normalized > this.size) throw new PersistentFrontierBufferError('INVALID_CURSOR', 'frontier cursor exceeds buffer size');
    return Object.freeze({ schema: WEBGPU_PERSISTENT_FRONTIER_BUFFER_SCHEMA, digest: this.payloadDigest, offset: normalized });
  }

  read({ cursor = null, limit = this.capacity } = {}) {
    const boundedLimit = positiveInteger(limit, 'frontier read limit');
    const offset = cursor == null ? 0 : (cursor.schema === WEBGPU_PERSISTENT_FRONTIER_BUFFER_SCHEMA && cursor.digest === this.payloadDigest ? nonNegativeInteger(cursor.offset, 'frontier cursor offset') : -1);
    if (offset < 0 || offset > this.size) throw new PersistentFrontierBufferError('INVALID_CURSOR', 'frontier cursor does not match this payload');
    const end = Math.min(this.size, offset + boundedLimit);
    return Object.freeze({ entries: publicEntries(this.entriesValue.slice(offset, end)), cursor: this.cursorAt(end), done: end === this.size, digest: this.payloadDigest });
  }

  enqueue(entries) {
    const normalized = normalizeEntries(entries);
    if (this.size + normalized.length > this.capacity) throw new PersistentFrontierBufferError('CAPACITY_EXCEEDED', 'frontier append exceeds capacity');
    this.entriesValue = this.entriesValue.concat(normalized); this.refreshDigest();
    return Object.freeze({ accepted: normalized.length, size: this.size, digest: this.payloadDigest });
  }

  cpuCompactionOracle() {
    const seen = new Set(), compacted = [];
    for (const entry of this.entriesValue) if (!seen.has(entry.key)) { seen.add(entry.key); compacted.push(entry); }
    return Object.freeze({ schema: WEBGPU_PERSISTENT_FRONTIER_BUFFER_SCHEMA, operation: FRONTIER_COMPACTION_OPERATION, inputDigest: this.payloadDigest, entries: publicEntries(compacted), outputDigest: digest(compacted), removed: this.size - compacted.length });
  }

  compactCpu() {
    const oracle = this.cpuCompactionOracle(); this.entriesValue = normalizeEntries(oracle.entries); this.refreshDigest();
    return Object.freeze({ ...oracle, digest: this.payloadDigest, size: this.size });
  }

  toPersistentPayload(cursor = null) {
    if (cursor != null) this.read({ cursor, limit: 1 });
    return Object.freeze({ schema: WEBGPU_PERSISTENT_FRONTIER_BUFFER_SCHEMA, capacity: this.capacity, entries: this.entries(), digest: this.payloadDigest, ...(cursor ? { cursor: clone(cursor) } : {}) });
  }

  prepareGpuCompactionHandoff(runtime = globalThis) {
    const oracle = this.cpuCompactionOracle();
    return Object.freeze({ schema: WEBGPU_PERSISTENT_FRONTIER_BUFFER_SCHEMA, operation: FRONTIER_COMPACTION_OPERATION, kind: 'gpu-compaction-handoff', webgpu: webGpuStatus(runtime), input: this.toPersistentPayload(), output: Object.freeze({ ordering: 'stable-first-key', expectedDigest: oracle.outputDigest, expectedSize: oracle.entries.length }), cpuOracle: oracle });
  }

  acceptGpuCompactionResult(result) {
    if (!result || result.schema !== WEBGPU_PERSISTENT_FRONTIER_BUFFER_SCHEMA || result.kind !== 'gpu-compaction-result' || result.operation !== FRONTIER_COMPACTION_OPERATION || result.inputDigest !== this.payloadDigest) throw new PersistentFrontierBufferError('INVALID_COMPACTION_RESULT', 'GPU frontier compaction result does not match this handoff');
    const entries = normalizeEntries(result.entries), oracle = this.cpuCompactionOracle();
    if (entries.length > this.capacity || !equalEntries(entries, oracle.entries)) throw new PersistentFrontierBufferError('PARITY_MISMATCH', 'GPU frontier compaction result differs from CPU oracle');
    this.entriesValue = entries; this.refreshDigest();
    return Object.freeze({ status: 'applied', backend: 'webgpu', parity: 'verified', digest: this.payloadDigest, size: this.size });
  }

  static fromPersistentPayload(payload) {
    if (!payload || payload.schema !== WEBGPU_PERSISTENT_FRONTIER_BUFFER_SCHEMA) throw new PersistentFrontierBufferError('INVALID_PERSISTENT_PAYLOAD', 'frontier payload schema is invalid');
    const buffer = new PersistentFrontierBuffer(payload);
    if (buffer.payloadDigest !== payload.digest) throw new PersistentFrontierBufferError('INVALID_PERSISTENT_PAYLOAD', 'frontier payload digest is invalid');
    if (payload.cursor) buffer.read({ cursor: payload.cursor, limit: 1 });
    return buffer;
  }
}

export { webGpuStatus };
