export const WEBGPU_FRONTIER_NAVIGATOR_SCHEMA = 'tdotdh.webgpu-frontier-navigator.v0';

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function nonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return number;
}

function normalizeCursor(cursor = {}) {
  return Object.freeze({
    depth: nonNegativeInteger(cursor.depth ?? 0, 'cursor.depth'),
    nodeOffset: nonNegativeInteger(cursor.nodeOffset ?? 0, 'cursor.nodeOffset'),
    rootChoice: nonNegativeInteger(cursor.rootChoice ?? 0, 'cursor.rootChoice'),
    ...(cursor.checkpoint != null ? { checkpoint: clone(cursor.checkpoint) } : {}),
  });
}

function assertForward(previous, next) {
  if (next.rootChoice !== previous.rootChoice) throw new TypeError('frontier navigator rootChoice cannot change during a run');
  if (next.depth < previous.depth) throw new TypeError('frontier navigator cursor depth cannot move backward');
  if (next.nodeOffset < previous.nodeOffset) throw new TypeError('frontier navigator cursor nodeOffset cannot move backward');
}

function hashWords(...arrays) {
  let hash = 2166136261;
  for (const array of arrays) for (const word of array || []) hash = Math.imul(hash ^ (Number(word) >>> 0), 16777619) >>> 0;
  return `fnv1a32-${hash.toString(16).padStart(8, '0')}`;
}

function ticketCopy(ticket, batchOrdinal) {
  if (!ticket || typeof ticket !== 'object') throw new TypeError('frontier navigator ticket is required');
  return Object.freeze({ ...clone(ticket), batchOrdinal });
}

function cancelledReceipt({ ticket, cursor, reason, batchOrdinal, active = null }) {
  return Object.freeze({
    schema: WEBGPU_FRONTIER_NAVIGATOR_SCHEMA,
    status: 'cancelled',
    backend: 'webgpu',
    parity: 'not-committed',
    reason,
    ticket: ticketCopy(ticket, batchOrdinal),
    cursor,
    checkpoint: Object.freeze({ schema: WEBGPU_FRONTIER_NAVIGATOR_SCHEMA, status: 'checkpointed', ticket: clone(ticket), cursor: clone(cursor), ...(active ? { active: clone(active) } : {}) }),
  });
}

/**
 * Keeps the frontier's GPU ownership local to the worker. GPU handles never
 * cross postMessage or enter checkpoints; only the canonical replay receipt
 * and a digest-bound cursor are durable.
 */
export function createWebGpuFrontierNavigator({ stateAdapter, ticket, cursor = {}, isCancelled = () => false, signal = null } = {}) {
  if (!stateAdapter || typeof stateAdapter.transition !== 'function') throw new TypeError('frontier navigator requires a labeled state adapter');
  const stableTicket = Object.freeze(clone(ticket));
  let latestCursor = normalizeCursor(cursor), batchOrdinal = 0, epoch = 0, active = null, cancelled = false;

  const currentCursor = () => latestCursor;
  const observeCursor = next => { const normalized = normalizeCursor(next); assertForward(latestCursor, normalized); latestCursor = normalized; return latestCursor; };
  const shouldCancel = () => cancelled || Boolean(signal?.aborted) || Boolean(isCancelled());
  const checkpoint = () => Object.freeze({ schema: WEBGPU_FRONTIER_NAVIGATOR_SCHEMA, status: 'checkpointed', ticket: clone(stableTicket), cursor: clone(latestCursor), ...(active ? { active: clone(active) } : {}) });
  const cancel = reason => { cancelled = true; return checkpoint(); };
  const reset = () => { active = null; cancelled = false; epoch = 0; batchOrdinal = 0; latestCursor = normalizeCursor(cursor); stateAdapter.reset?.(); };

  return Object.freeze({
    schema: WEBGPU_FRONTIER_NAVIGATOR_SCHEMA,
    ticket: stableTicket,
    cursor: currentCursor,
    observeCursor,
    checkpoint,
    cancel,
    reset,
    beginLayer() { return stateAdapter.beginLayer ? stateAdapter.beginLayer() : Object.freeze({ schema: WEBGPU_FRONTIER_NAVIGATOR_SCHEMA, status: 'layer-open', epoch: active?.epoch || 0 }); },
    commitLayer() { return stateAdapter.commitLayer ? stateAdapter.commitLayer() : Object.freeze({ schema: WEBGPU_FRONTIER_NAVIGATOR_SCHEMA, status: 'layer-committed', epoch: active?.epoch || 0 }); },
    async availability() { return stateAdapter.availability ? stateAdapter.availability() : Object.freeze({ status: 'available', backend: 'webgpu' }); },
    async expand(candidates, { cursor: nextCursor = latestCursor } = {}) {
      const normalizedCursor = observeCursor(nextCursor), ordinal = batchOrdinal++, batchTicket = ticketCopy(stableTicket, ordinal);
      if (shouldCancel()) return cancelledReceipt({ ticket: stableTicket, cursor: normalizedCursor, reason: 'cancelled-before-dispatch', batchOrdinal: ordinal, active });
      const result = await stateAdapter.transition(candidates);
      if (shouldCancel()) return cancelledReceipt({ ticket: stableTicket, cursor: normalizedCursor, reason: 'cancelled-before-commit', batchOrdinal: ordinal, active });
      if (result?.status !== 'completed' || result?.backend !== 'webgpu' || result?.parity !== 'verified') return Object.freeze({ ...result, navigator: { schema: WEBGPU_FRONTIER_NAVIGATOR_SCHEMA, status: 'fallback', ticket: batchTicket, cursor: normalizedCursor } });
      epoch += 1;
      active = Object.freeze({ epoch, digest: hashWords(result.absoluteHashes, result.canonicalHashes), candidateCount: result.candidateCount, bufferCapacity: result.bufferCapacity ?? null, readback: 'canonical-replay-only' });
      return Object.freeze({ ...result, navigator: { schema: WEBGPU_FRONTIER_NAVIGATOR_SCHEMA, status: 'resident', ticket: batchTicket, cursor: normalizedCursor, epoch: active.epoch, digest: active.digest, candidateCount: active.candidateCount, bufferCapacity: active.bufferCapacity, readback: active.readback } });
    },
  });
}
