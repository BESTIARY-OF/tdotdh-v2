import { checkpointWorkCursor, createWorkCursor, completeWorkCursor } from '../../search-core/src/work-cursor.js';

function nonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return number;
}

/** Convert the worker's bounded cursor shape to the canonical v2 work cursor. */
export function protocolCursorToWorkCursor(protocolCursor = {}, ticket, { runSeed = '', status = 'running' } = {}) {
  const position = {
    branchCursor: nonNegativeInteger(protocolCursor.rootChoice ?? 0, 'cursor.rootChoice'),
    depth: nonNegativeInteger(protocolCursor.depth ?? 0, 'cursor.depth'),
    nodeCursor: nonNegativeInteger(protocolCursor.nodeOffset ?? 0, 'cursor.nodeOffset'),
  };
  const ready = createWorkCursor(ticket, { runSeed, ...position });
  if (status === 'ready') return ready;
  const running = checkpointWorkCursor(ready, position);
  if (status === 'running') return running;
  if (status === 'complete') return completeWorkCursor(running);
  throw new TypeError(`Unsupported cursor status: ${status}`);
}

/** Convert the canonical work cursor to the worker protocol's stable shape. */
export function workCursorToProtocolCursor(workCursor) {
  if (!workCursor || typeof workCursor !== 'object') throw new TypeError('A work cursor is required');
  return {
    depth: nonNegativeInteger(workCursor.depth, 'depth'),
    nodeOffset: nonNegativeInteger(workCursor.nodeCursor, 'nodeCursor'),
    rootChoice: nonNegativeInteger(workCursor.branchCursor, 'branchCursor'),
  };
}
