import { canonicalPlacementSignature } from './cpu-oracle-runner.js';

export const NAVIGATION_COORDINATOR_SCHEMA = 'tdotdh.navigation-coordinator.v0';

function integer(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return number;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCursor(cursor = {}) {
  return Object.freeze({
    depth: integer(cursor.depth ?? 0, 'cursor.depth'),
    nodeOffset: integer(cursor.nodeOffset ?? 0, 'cursor.nodeOffset'),
    rootChoice: integer(cursor.rootChoice ?? 0, 'cursor.rootChoice'),
    ...(cursor.checkpoint != null ? { checkpoint: clone(cursor.checkpoint) } : {}),
  });
}

function assertForward(previous, next) {
  if (next.rootChoice !== previous.rootChoice) throw new TypeError('navigation cursor rootChoice cannot change during a run');
  if (next.depth < previous.depth) throw new TypeError('navigation cursor depth cannot move backward');
  if (next.nodeOffset < previous.nodeOffset) throw new TypeError('navigation cursor nodeOffset cannot move backward');
}

function requireStage(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 96) throw new TypeError('navigation batch stage must be a non-empty string of at most 96 characters');
  return value;
}

/** Owns the product-search lifecycle receipt without owning search topology. */
export function createNavigationCoordinator({ ticket, cursor = {} } = {}) {
  if (!ticket || typeof ticket !== 'object') throw new TypeError('navigation ticket is required');
  const stableTicket = Object.freeze(clone(ticket));
  const startCursor = normalizeCursor(cursor);
  let latestCursor = startCursor;
  let progressCount = 0;
  let batchCount = 0;
  let cancellationChecks = 0;

  const observeProgress = nextCursor => {
    const normalized = normalizeCursor(nextCursor);
    assertForward(latestCursor, normalized);
    latestCursor = normalized;
    progressCount += 1;
    return latestCursor;
  };

  const beginBatch = ({ stage, depth = latestCursor.depth, nodeOffset = latestCursor.nodeOffset, candidateCount = 0 } = {}) => {
    const nextCursor = normalizeCursor({ ...latestCursor, depth: Math.max(latestCursor.depth, integer(depth, 'batch.depth')), nodeOffset: Math.max(latestCursor.nodeOffset, integer(nodeOffset, 'batch.nodeOffset')) });
    const receipt = Object.freeze({ schema: NAVIGATION_COORDINATOR_SCHEMA, ordinal: batchCount, stage: requireStage(stage), ticket: Object.freeze({ ...stableTicket, batchOrdinal: batchCount, stage: requireStage(stage) }), cursor: nextCursor, candidateCount: integer(candidateCount, 'batch.candidateCount') });
    batchCount += 1;
    return receipt;
  };

  const observeCancellation = cancelled => {
    cancellationChecks += 1;
    return Object.freeze({ checked: true, cancelled: Boolean(cancelled), count: cancellationChecks, cursor: latestCursor });
  };

  const complete = result => {
    const resultCursor = result?.cursor ? observeProgress(result.cursor) : latestCursor;
    const placements = Array.isArray(result?.placements) && result.placements.length ? result.placements : null;
    const canonicalSignature = placements ? canonicalPlacementSignature(placements) : null;
    return Object.freeze({
      schema: NAVIGATION_COORDINATOR_SCHEMA,
      status: placements ? 'completed' : resultCursor.checkpoint ? 'checkpointed' : 'exhausted',
      ticket: stableTicket,
      startCursor,
      cursor: resultCursor,
      progressCount,
      batchCount,
      cancellationChecks,
      canonicalReplay: placements ? 'verified' : 'not-run',
      ...(canonicalSignature ? { canonicalSignature } : {}),
    });
  };

  return Object.freeze({ ticket: stableTicket, cursor: () => latestCursor, beginBatch, observeProgress, observeCancellation, complete });
}
