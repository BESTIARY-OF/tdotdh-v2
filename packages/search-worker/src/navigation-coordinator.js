import { canonicalPlacementSignature } from './cpu-oracle-runner.js';

export const NAVIGATION_COORDINATOR_SCHEMA = 'tdotdh.navigation-coordinator.v0';

const NAVIGATION_STAGE_KEYS = Object.freeze([
  'frontierTargetPool',
  'frontierTargetGeneration',
  'frontierGeneration',
  'navigationPlan',
  'frontierMetrics',
  'fieldMetrics',
  'frontier',
  'frontierState',
  'frontierTopology',
  'frontierScore',
  'frontierRanker',
  'frontierCompactor',
  'frontierDedup',
]);

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

function requireLabel(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 96) throw new TypeError(`${name} must be a non-empty string of at most 96 characters`);
  return value;
}

function summarizeStages(result) {
  const gpuStages = [], cpuFallbackStages = [];
  for (const stage of NAVIGATION_STAGE_KEYS) {
    const receipt = result?.[stage];
    if (!receipt || receipt.status === 'cpu-oracle') continue;
    if (receipt.status === 'used' && receipt.parity === 'verified' && ['webgpu', 'compute-shader', 'resident-webgpu'].includes(receipt.backend)) gpuStages.push(stage);
    else cpuFallbackStages.push(stage);
  }
  return { gpuStages: Object.freeze(gpuStages), cpuFallbackStages: Object.freeze(cpuFallbackStages) };
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

  const beginBatch = ({ stage, backend = 'webgpu', ownership = 'gpu-first', depth = latestCursor.depth, nodeOffset = latestCursor.nodeOffset, candidateCount = 0 } = {}) => {
    const nextCursor = normalizeCursor({ ...latestCursor, depth: Math.max(latestCursor.depth, integer(depth, 'batch.depth')), nodeOffset: Math.max(latestCursor.nodeOffset, integer(nodeOffset, 'batch.nodeOffset')) });
    const normalizedStage = requireStage(stage), normalizedBackend = requireLabel(backend, 'navigation batch backend'), normalizedOwnership = requireLabel(ownership, 'navigation batch ownership');
    const receipt = Object.freeze({ schema: NAVIGATION_COORDINATOR_SCHEMA, ordinal: batchCount, stage: normalizedStage, backend: normalizedBackend, ownership: normalizedOwnership, ticket: Object.freeze({ ...stableTicket, batchOrdinal: batchCount, stage: normalizedStage, backend: normalizedBackend }), cursor: nextCursor, candidateCount: integer(candidateCount, 'batch.candidateCount') });
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
    const expansion = result?.frontierTargetGeneration?.status === 'used' ? result.frontierTargetGeneration : result?.frontierGeneration?.status === 'used' ? result.frontierGeneration : null;
    const expansionStage = result?.frontierTargetGeneration?.status === 'used' ? 'frontierTargetGeneration' : result?.frontierGeneration?.status === 'used' ? 'frontierGeneration' : null;
    const expansionBackend = expansion?.backend || 'cpu-oracle';
    const expansionParity = expansion?.parity || 'oracle';
    const stageSummary = summarizeStages(result);
    const gatedExecution = result?.gpuExecution && typeof result.gpuExecution === 'object';
    const deviceReady = gatedExecution ? result.gpuExecution.deviceAvailable === true : expansionBackend === 'webgpu' && expansionParity === 'verified';
    const gpuExpansionComplete = Boolean(deviceReady && expansionStage && stageSummary.gpuStages.includes(expansionStage) && stageSummary.gpuStages.includes('frontierState') && stageSummary.cpuFallbackStages.length === 0);
    return Object.freeze({
      schema: NAVIGATION_COORDINATOR_SCHEMA,
      status: placements ? 'completed' : resultCursor.checkpoint ? 'checkpointed' : 'exhausted',
      ticket: stableTicket,
      startCursor,
      cursor: resultCursor,
      progressCount,
      batchCount,
      cancellationChecks,
      expansionBackend,
      expansionParity,
      expansionOwnership: gpuExpansionComplete ? 'gpu-owned' : 'cpu-oracle-fallback',
      gpuExpansionComplete,
      gpuExpansionBatches: gpuExpansionComplete ? batchCount : 0,
      gpuStages: stageSummary.gpuStages,
      cpuFallbackStages: stageSummary.cpuFallbackStages,
      ...(gatedExecution ? { gpuExecution: Object.freeze({ deviceAvailable: Boolean(result.gpuExecution.deviceAvailable), reason: result.gpuExecution.reason || null }) } : {}),
      canonicalReplay: placements ? 'verified' : 'not-run',
      ...(canonicalSignature ? { canonicalSignature } : {}),
    });
  };

  return Object.freeze({ ticket: stableTicket, cursor: () => latestCursor, beginBatch, observeProgress, observeCancellation, complete });
}
