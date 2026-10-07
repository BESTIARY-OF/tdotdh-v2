import { createFrontierMaskFromCells } from '../../../packages/search-core/src/webgpu-frontier-validator.js';
import { createFrontierPrefilter } from '../../../packages/search-core/src/frontier-prefilter.js';
import { sliceFrontierBatch } from '../../../packages/search-core/src/frontier-batch-contract.js';
import { canonicalPlacementSignature } from './cpu-oracle-runner.js';
import { FRONTIER_BATCH_OPERATION, normalizeFrontierBatch } from './frontier-batch-contract.js';

export async function runFrontierBatch(request, { isCancelled = () => false, reportProgress = () => {}, frontierValidator = null, now = () => Date.now() } = {}) {
  if (request.operation !== FRONTIER_BATCH_OPERATION) throw new TypeError(`Unsupported frontier operation: ${request.operation}`);
  const batch = normalizeFrontierBatch(request.frontierBatch);
  const startedAt = now();
  const windowResult = sliceFrontierBatch(batch, { nodeOffset: request.cursor.nodeOffset, maxNodes: request.budget.maxNodes });
  const { start, candidates: window } = windowResult;
  if (isCancelled()) return null;
  if (window.length === 0) {
    return {
      operation: FRONTIER_BATCH_OPERATION,
      placements: [],
      canonicalSignatures: [],
      nodes: 0,
      cursor: { ...request.cursor },
      frontier: { status: 'complete', backend: 'cpu-oracle', reason: 'cursor-at-end' },
      termination: { status: 'completed', elapsedMilliseconds: Math.max(0, now() - startedAt), maxMilliseconds: request.budget.maxMilliseconds },
    };
  }

  const masks = window.map((candidate, index) => ({
    parentMask: createFrontierMaskFromCells(candidate.parentCells),
    candidateMask: createFrontierMaskFromCells(candidate.candidateCells),
    depth: candidate.depth,
    nodeCursor: start + index,
  }));
  const prefilter = createFrontierPrefilter({ accelerator: frontierValidator });
  const filtered = await prefilter.prefilter(masks, { isCancelled });
  if (filtered.status === 'cancelled' || isCancelled()) return null;
  const validity = filtered.validity;
  const frontier = filtered.prefilter;
  if (now() - startedAt >= request.budget.maxMilliseconds) {
    return {
      operation: FRONTIER_BATCH_OPERATION,
      placements: [],
      canonicalSignatures: [],
      nodes: 0,
      cursor: { ...request.cursor },
      mode: request.mode,
      frontier,
      termination: { status: 'time-budget', elapsedMilliseconds: Math.max(0, now() - startedAt), maxMilliseconds: request.budget.maxMilliseconds },
    };
  }

  const signatures = [];
  let selectedPlacements = null;
  let processed = 0;
  for (let index = 0; index < window.length; index += 1) {
    if (isCancelled()) break;
    if (processed > 0 && now() - startedAt >= request.budget.maxMilliseconds) break;
    const candidate = window[index];
    if (validity[index] === 1) {
      const signature = canonicalPlacementSignature(candidate.placements);
      if (!request.knownSignatureHints.includes(signature) && !signatures.includes(signature)) {
        signatures.push(signature);
        if (!selectedPlacements) selectedPlacements = candidate.placements;
      }
    }
    processed = index + 1;
    reportProgress({ nodes: processed, depth: candidate.depth, frontier: window.length - processed, families: signatures.length, cursor: { ...request.cursor, depth: candidate.depth, nodeOffset: start + processed } });
    await Promise.resolve();
  }
  if (isCancelled()) return null;
  return {
    operation: FRONTIER_BATCH_OPERATION,
    placements: selectedPlacements || [],
    canonicalSignatures: signatures,
    nodes: processed,
    cursor: { ...request.cursor, nodeOffset: start + processed },
    mode: request.mode,
    frontier,
    termination: { status: processed < window.length ? 'partial' : 'completed', elapsedMilliseconds: Math.max(0, now() - startedAt), maxMilliseconds: request.budget.maxMilliseconds },
  };
}
