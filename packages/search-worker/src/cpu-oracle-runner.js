import { createSearchRequest } from './protocol.js';

function cellKey(cell) {
  if (!Number.isSafeInteger(cell?.x) || !Number.isSafeInteger(cell?.y)) {
    throw new TypeError('candidate cells require safe integer x and y coordinates');
  }
  return `${cell.x},${cell.y}`;
}

function canonicalPlacementSignature(placements) {
  if (!Array.isArray(placements) || placements.length === 0) {
    throw new TypeError('candidate placements must be a non-empty array');
  }
  return [...placements]
    .map((placement, index) => {
      const pieceId = String(placement?.pieceId ?? placement?.id ?? index);
      const cells = [...(placement?.cells ?? [])].map(cellKey).sort((a, b) => {
        const [ax, ay] = a.split(',').map(Number);
        const [bx, by] = b.split(',').map(Number);
        return ay - by || ax - bx;
      });
      if (cells.length === 0) throw new TypeError(`placement ${pieceId} must contain cells`);
      return `${pieceId}:${cells.join(';')}`;
    })
    .sort()
    .join('|');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Run a bounded deterministic CPU batch over candidate arrangements.
 *
 * This is intentionally a small oracle runner: the published field-guide
 * worker remains the v1 compatibility implementation, while this module
 * establishes the v2 ticket/cursor/signature seam that a compute backend must
 * match exactly before it can be enabled.
 */
export async function runCpuOracleBatch(input, { reportProgress = () => {}, isCancelled = () => false, candidatePrefilter = null } = {}) {
  const request = input?.type === 'start' ? createSearchRequest(input) : input;
  if (!request?.ticket || !request?.cursor || !request?.budget) throw new TypeError('a normalized search request is required');
  const candidates = request.constraints?.candidateArrangements;
  if (!Array.isArray(candidates)) throw new TypeError('constraints.candidateArrangements must be an array');

  const start = request.cursor.nodeOffset;
  const limit = Math.min(request.budget.maxNodes, candidates.length - start);
  let prefilterReceipt = null;
  let validity = null;
  if (candidatePrefilter?.prefilter && typeof candidatePrefilter.prefilter === 'function') {
    const candidateResult = await candidatePrefilter.prefilter(candidates);
    if (candidateResult?.status === 'completed' && Array.isArray(candidateResult.validity) && candidateResult.validity.length === candidates.length) {
      validity = candidateResult.validity;
      prefilterReceipt = { status: 'used', backend: candidateResult.backend || 'compute-shader', candidateCount: candidates.length };
    } else {
      prefilterReceipt = { status: 'fallback', reason: candidateResult?.reason || 'prefilter-unavailable' };
    }
  }
  const signatures = [];
  let selectedPlacements = [];
  let nodes = 0;

  for (let index = 0; index < limit; index += 1) {
    if (isCancelled()) break;
    if (validity && validity[start + index] !== 1) {
      nodes += 1;
      reportProgress({ nodes, depth: request.cursor.depth, frontier: 0, families: signatures.length, cursor: { ...request.cursor, nodeOffset: start + index + 1 } });
      await Promise.resolve();
      continue;
    }
    const placements = clone(candidates[start + index]);
    const signature = canonicalPlacementSignature(placements);
    if (!signatures.includes(signature) && !request.knownSignatureHints.includes(signature)) {
      signatures.push(signature);
      if (selectedPlacements.length === 0) selectedPlacements = placements;
    }
    nodes += 1;
    reportProgress({ nodes, depth: request.cursor.depth, frontier: 0, families: signatures.length, cursor: { ...request.cursor, nodeOffset: start + index + 1 } });
    await Promise.resolve();
  }

  return {
    placements: selectedPlacements,
    canonicalSignatures: signatures,
    nodes,
    cursor: { ...request.cursor, nodeOffset: start + nodes },
    ticket: { ...request.ticket },
    cancelled: isCancelled(),
    ...(prefilterReceipt ? { prefilter: prefilterReceipt } : {}),
  };
}

export { canonicalPlacementSignature };
