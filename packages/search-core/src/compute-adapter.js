import { ticketKey } from './work-ticket.js';
import { cursorMatchesTicket } from './work-cursor.js';

export const SEARCH_MODES = Object.freeze({ breadth: 'breadth', depth: 'depth' });
export const COMPUTE_ADAPTER_STATUS = Object.freeze({ available: 'available', unavailable: 'unavailable' });

function requireMode(mode) {
  if (mode !== SEARCH_MODES.breadth && mode !== SEARCH_MODES.depth) throw new TypeError(`Unsupported search mode: ${mode}`);
  return mode;
}

function requireCanonicalSignature(signature) {
  if (typeof signature !== 'string' || !signature.trim()) throw new TypeError('A non-empty canonical arrangement signature is required');
  return signature;
}

function unavailable(reason = 'compute-shader-unavailable') {
  return Object.freeze({ status: COMPUTE_ADAPTER_STATUS.unavailable, backend: 'compute-shader', reason: String(reason) });
}

export function createComputeSearchRequest({ mode, ticket, cursor, runSeed, knownSignatures = [] } = {}) {
  requireMode(mode);
  if (!ticket || typeof ticket !== 'object') throw new TypeError('A deterministic work ticket is required');
  const normalizedTicketKey = ticketKey(ticket);
  if (!cursorMatchesTicket(cursor, ticket, { runSeed })) throw new Error('The resumable cursor does not match the ticket and run seed');
  if (!Array.isArray(knownSignatures) || knownSignatures.some(signature => typeof signature !== 'string' || !signature)) throw new TypeError('knownSignatures must be an array of non-empty strings');
  const sortedSignatures = [...new Set(knownSignatures)].sort();
  return Object.freeze({
    contractVersion: 1,
    mode,
    ticket: Object.freeze({ ...ticket }),
    ticketKey: normalizedTicketKey,
    runSeed: String(runSeed),
    deterministicKey: `${String(runSeed)}:${normalizedTicketKey}`,
    cursor: Object.freeze({ ...cursor }),
    knownSignatures: Object.freeze(sortedSignatures),
  });
}

export function createUnavailableComputeAdapter(reason) {
  const status = unavailable(reason);
  return Object.freeze({
    backend: 'compute-shader',
    availability: () => status,
    execute: async () => status,
  });
}

export function createCpuOracleFirstAdapter({ cpuOracle, computeShader = null, unavailableReason } = {}) {
  if (typeof cpuOracle !== 'function') throw new TypeError('cpuOracle must be a function');
  const acceleratorStatus = computeShader?.available === true
    ? Object.freeze({ status: COMPUTE_ADAPTER_STATUS.available, backend: 'compute-shader' })
    : unavailable(unavailableReason);
  return Object.freeze({
    backend: 'cpu-oracle-first',
    availability: () => acceleratorStatus,
    execute: async input => {
      const request = createComputeSearchRequest(input);
      const oracle = await cpuOracle(request);
      const canonicalSignature = requireCanonicalSignature(oracle?.canonicalSignature);
      return Object.freeze({
        status: 'completed',
        backend: 'cpu-oracle',
        mode: request.mode,
        ticketKey: request.ticketKey,
        canonicalSignature,
        placements: oracle.placements ?? null,
        accelerator: acceleratorStatus,
      });
    },
  });
}
