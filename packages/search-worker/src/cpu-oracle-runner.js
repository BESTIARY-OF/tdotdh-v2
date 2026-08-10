import { createSearchRequest } from './protocol.js';
import { protocolCursorToWorkCursor, workCursorToProtocolCursor } from './cursor-bridge.js';

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
  const cells = placements.flatMap(placement => placement?.cells ?? []);
  if (cells.length === 0) throw new TypeError('candidate placements must contain cells');
  const origin = cells.reduce((bounds, cell) => {
    const { x, y } = cellKey(cell).split(',').map(Number);
    return { minX: Math.min(bounds.minX, x), minY: Math.min(bounds.minY, y) };
  }, { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY });
  return [...placements]
    .map((placement, index) => {
      const pieceId = String(placement?.pieceId ?? placement?.id ?? index);
      const normalizedCells = [...(placement?.cells ?? [])].map(cell => `${cell.x - origin.minX},${cell.y - origin.minY}`).sort((a, b) => {
        const [ax, ay] = a.split(',').map(Number);
        const [bx, by] = b.split(',').map(Number);
        return ay - by || ax - bx;
      });
      if (normalizedCells.length === 0) throw new TypeError(`placement ${pieceId} must contain cells`);
      return `${pieceId}:${normalizedCells.join(';')}`;
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
export async function runCpuOracleBatch(input, { reportProgress = () => {}, isCancelled = () => false, candidatePrefilter = null, now = () => performance.now() } = {}) {
  const request = input?.type === 'start' ? createSearchRequest(input) : input;
  if (!request?.ticket || !request?.cursor || !request?.budget) throw new TypeError('a normalized search request is required');
  const workCursor = protocolCursorToWorkCursor(request.cursor, request.ticket, { runSeed: request.seed });
  const candidates = request.constraints?.candidateArrangements;
  if (!Array.isArray(candidates)) throw new TypeError('constraints.candidateArrangements must be an array');

  const startedAt = now();
  const deadline = startedAt + request.budget.maxMilliseconds;
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
  let terminationStatus = 'completed';
  const cursorAt = nodeCursor => workCursorToProtocolCursor({ ...workCursor, nodeCursor });

  for (let index = 0; index < limit; index += 1) {
    if (isCancelled()) {
      terminationStatus = 'cancelled';
      break;
    }
    if (nodes > 0 && now() >= deadline) {
      terminationStatus = 'time-budget';
      break;
    }
    if (validity && validity[start + index] !== 1) {
      nodes += 1;
      reportProgress({ nodes, depth: request.cursor.depth, frontier: 0, families: signatures.length, cursor: cursorAt(start + index + 1) });
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
    reportProgress({ nodes, depth: request.cursor.depth, frontier: 0, families: signatures.length, cursor: cursorAt(start + index + 1) });
    await Promise.resolve();
  }

  return {
    placements: selectedPlacements,
    canonicalSignatures: signatures,
    nodes,
    cursor: cursorAt(start + nodes),
    ticket: { ...request.ticket },
    cancelled: isCancelled(),
    termination: {
      status: terminationStatus,
      elapsedMilliseconds: Math.max(0, now() - startedAt),
      maxMilliseconds: request.budget.maxMilliseconds,
    },
    ...(prefilterReceipt ? { prefilter: prefilterReceipt } : {}),
  };
}

export { canonicalPlacementSignature };
