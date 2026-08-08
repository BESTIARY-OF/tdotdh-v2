import { ticketKey } from './work-ticket.js';

export const WORK_CURSOR_SCHEMA_VERSION = 1;

const CURSOR_STATES = new Set(['ready', 'running', 'complete']);

function nonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return number;
}

function normalizeTicket(ticket) {
  if (!ticket || typeof ticket !== 'object') throw new TypeError('A work ticket is required');
  if (typeof ticket.presetFingerprint !== 'string' || !ticket.presetFingerprint) throw new TypeError('ticket.presetFingerprint must be a non-empty string');
  if (typeof ticket.familyId !== 'string' || !ticket.familyId) throw new TypeError('ticket.familyId must be a non-empty string');
  return {
    presetFingerprint: ticket.presetFingerprint,
    familyId: ticket.familyId,
    pass: nonNegativeInteger(ticket.pass, 'ticket.pass'),
    threadId: nonNegativeInteger(ticket.threadId, 'ticket.threadId'),
  };
}

function normalizePosition(position = {}) {
  return {
    branchCursor: nonNegativeInteger(position.branchCursor ?? 0, 'branchCursor'),
    depth: nonNegativeInteger(position.depth ?? 0, 'depth'),
    nodeCursor: nonNegativeInteger(position.nodeCursor ?? 0, 'nodeCursor'),
  };
}

function cursorFrom(value) {
  if (!value || typeof value !== 'object') throw new TypeError('A work cursor is required');
  if (value.schemaVersion !== WORK_CURSOR_SCHEMA_VERSION) throw new RangeError(`Unsupported work cursor schema: ${value.schemaVersion}`);
  if (!CURSOR_STATES.has(value.status)) throw new TypeError(`Unsupported work cursor state: ${value.status}`);
  const ticket = normalizeTicket(value.ticket);
  if (value.ticketKey !== ticketKey(ticket)) throw new Error('Work cursor ticketKey does not match its ticket');
  return { ...value, ticket, ...normalizePosition(value), runSeed: String(value.runSeed ?? '') };
}

export function createWorkCursor(ticket, { runSeed = '', branchCursor = 0, depth = 0, nodeCursor = 0 } = {}) {
  const normalizedTicket = normalizeTicket(ticket);
  return {
    schemaVersion: WORK_CURSOR_SCHEMA_VERSION,
    ticket: normalizedTicket,
    ticketKey: ticketKey(normalizedTicket),
    runSeed: String(runSeed),
    status: 'ready',
    ...normalizePosition({ branchCursor, depth, nodeCursor }),
  };
}

export function checkpointWorkCursor(cursor, position) {
  const current = cursorFrom(cursor);
  if (current.status === 'complete') throw new Error('A complete work cursor cannot be checkpointed');
  return { ...current, ...normalizePosition(position), status: 'running' };
}

export function cursorMatchesTicket(cursor, ticket, { runSeed } = {}) {
  try {
    const current = cursorFrom(cursor), normalizedTicket = normalizeTicket(ticket);
    return current.ticketKey === ticketKey(normalizedTicket) && (runSeed === undefined || current.runSeed === String(runSeed));
  } catch {
    return false;
  }
}

export function resumeWorkCursor(ticket, savedCursor, { runSeed = '' } = {}) {
  const normalizedTicket = normalizeTicket(ticket);
  if (savedCursor == null) return createWorkCursor(normalizedTicket, { runSeed });
  const parsed = typeof savedCursor === 'string' ? deserializeWorkCursor(savedCursor) : cursorFrom(savedCursor);
  if (!cursorMatchesTicket(parsed, normalizedTicket, { runSeed })) throw new Error('Saved work cursor belongs to a different ticket or run seed');
  if (parsed.status === 'complete') throw new Error('A complete work cursor cannot be resumed');
  return { ...parsed, status: 'running' };
}

export function completeWorkCursor(cursor) {
  const current = cursorFrom(cursor);
  return { ...current, status: 'complete' };
}

export function serializeWorkCursor(cursor) {
  return JSON.stringify(cursorFrom(cursor));
}

export function deserializeWorkCursor(serialized) {
  if (typeof serialized !== 'string') throw new TypeError('Serialized work cursor must be a string');
  try {
    return cursorFrom(JSON.parse(serialized));
  } catch (error) {
    throw new Error(`Invalid serialized work cursor: ${error.message}`);
  }
}
