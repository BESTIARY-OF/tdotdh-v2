import { cpuValidateFrontierCandidates, createFrontierMaskFromCells } from '../../../packages/search-core/src/webgpu-frontier-validator.js';
import { canonicalPlacementSignature } from './cpu-oracle-runner.js';
import { FRONTIER_BATCH_OPERATION, normalizeFrontierBatch } from './frontier-batch-contract.js';

export async function runFrontierBatch(request, { isCancelled = () => false, reportProgress = () => {}, frontierValidator = null, now = () => Date.now() } = {}) {
  if (request.operation !== FRONTIER_BATCH_OPERATION) throw new TypeError(`Unsupported frontier operation: ${request.operation}`);
  const batch = normalizeFrontierBatch(request.frontierBatch);
  const startedAt = now();
  const start = request.cursor.nodeOffset;
  const end = Math.min(batch.candidates.length, start + request.budget.maxNodes);
  const window = batch.candidates.slice(start, end);
  if (isCancelled()) return null;

  const masks = window.map(candidate => ({
    parentMask: createFrontierMaskFromCells(candidate.parentCells),
    candidateMask: createFrontierMaskFromCells(candidate.candidateCells),
    depth: candidate.depth,
    nodeCursor: start + candidate.id,
  }));
  const cpu = cpuValidateFrontierCandidates(masks);
  let validity = cpu.validity;
  let frontier = { status: 'fallback', backend: 'cpu-oracle', reason: 'frontier-accelerator-unavailable' };
  if (frontierValidator?.validate && !isCancelled()) {
    const accelerated = await frontierValidator.validate(masks);
    if (accelerated?.status === 'completed' && JSON.stringify(accelerated.validity) === JSON.stringify(cpu.validity)) {
      validity = accelerated.validity;
      frontier = { status: 'used', backend: accelerated.backend || 'webgpu', parity: 'verified', candidateCount: window.length };
    } else if (accelerated?.status === 'completed') {
      frontier = { status: 'rejected', backend: accelerated.backend || 'webgpu', reason: 'validity-mask-mismatch', candidateCount: window.length };
    } else if (accelerated?.reason) {
      frontier = { status: 'fallback', backend: 'cpu-oracle', reason: accelerated.reason };
    }
  }

  const signatures = [];
  let selectedPlacements = null;
  let processed = 0;
  for (let index = 0; index < window.length; index += 1) {
    if (isCancelled()) break;
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
    frontier,
    termination: { status: processed < window.length ? 'partial' : 'completed', elapsedMilliseconds: Math.max(0, now() - startedAt), maxMilliseconds: request.budget.maxMilliseconds },
  };
}
