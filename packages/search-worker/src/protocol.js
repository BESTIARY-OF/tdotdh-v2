/**
 * Versioned, bounded transport for a search worker.
 *
 * The executor is injected: this module owns message ordering, validation,
 * ticket/cursor identity, and cancellation acknowledgement, but not search
 * topology. Executors must yield between batches so cancellation can be seen.
 */

export const WORKER_PROTOCOL_VERSION = 1;
export const MAX_SIGNATURE_HINTS = 256;
export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const MAX_RESULT_BYTES = 4 * 1024 * 1024;

const MAX_REQUEST_ID_LENGTH = 128;
const MAX_ID_LENGTH = 256;
const MAX_SEED_LENGTH = 256;
const MAX_SIGNATURE_LENGTH = 4096;
const MAX_PIECES = 64;
const MAX_CELLS_PER_PIECE = 256;
const MAX_BUDGET_NODES = 10_000_000;
const MAX_BUDGET_MILLISECONDS = 15 * 60 * 1000;

export class WorkerProtocolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WorkerProtocolError";
    this.code = code;
    this.details = details;
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkerProtocolError("INVALID_PAYLOAD", `${label} must be an object.`);
  }
  return value;
}

function requireString(value, label, maxLength = MAX_ID_LENGTH) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new WorkerProtocolError("INVALID_PAYLOAD", `${label} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value;
}

function finiteInteger(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new WorkerProtocolError("INVALID_PAYLOAD", `${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return number;
}

function cloneJson(value, label) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new WorkerProtocolError("INVALID_PAYLOAD", `${label} must be JSON-serializable.`, { cause: error.message });
  }
}

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function normalizeTicket(value, presetFingerprint) {
  const ticket = requireObject(value, "ticket");
  const normalized = {
    presetFingerprint: requireString(ticket.presetFingerprint, "ticket.presetFingerprint"),
    familyId: requireString(ticket.familyId, "ticket.familyId"),
    pass: finiteInteger(ticket.pass, "ticket.pass"),
    threadId: finiteInteger(ticket.threadId, "ticket.threadId"),
  };
  if (normalized.presetFingerprint !== presetFingerprint) {
    throw new WorkerProtocolError("IDENTITY_MISMATCH", "ticket.presetFingerprint must match presetFingerprint.");
  }
  return normalized;
}

function normalizeCursor(value = {}) {
  const cursor = requireObject(value, "cursor");
  return {
    depth: finiteInteger(cursor.depth ?? 0, "cursor.depth"),
    nodeOffset: finiteInteger(cursor.nodeOffset ?? 0, "cursor.nodeOffset"),
    rootChoice: finiteInteger(cursor.rootChoice ?? 0, "cursor.rootChoice"),
  };
}

function normalizeHints(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new WorkerProtocolError("INVALID_PAYLOAD", "knownSignatureHints must be an array.");
  }

  const unique = [];
  const seen = new Set();
  for (const signature of value) {
    requireString(signature, "knownSignatureHints entry", MAX_SIGNATURE_LENGTH);
    if (!seen.has(signature)) {
      seen.add(signature);
      unique.push(signature);
    }
  }
  if (unique.length > MAX_SIGNATURE_HINTS) {
    throw new WorkerProtocolError("SIGNATURE_HINT_LIMIT", `knownSignatureHints cannot exceed ${MAX_SIGNATURE_HINTS} entries.`, {
      received: unique.length,
      maximum: MAX_SIGNATURE_HINTS,
    });
  }
  return unique;
}

function normalizePieces(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PIECES) {
    throw new WorkerProtocolError("INVALID_PAYLOAD", `pieces must contain between 1 and ${MAX_PIECES} entries.`);
  }
  return value.map((piece, index) => {
    const normalized = requireObject(piece, `pieces[${index}]`);
    if (normalized.cells != null && (!Array.isArray(normalized.cells) || normalized.cells.length > MAX_CELLS_PER_PIECE)) {
      throw new WorkerProtocolError("INVALID_PAYLOAD", `pieces[${index}].cells exceeds the bound.`);
    }
    return cloneJson(normalized, `pieces[${index}]`);
  });
}

function normalizeBudget(value) {
  const budget = requireObject(value, "budget");
  return {
    maxNodes: finiteInteger(budget.maxNodes, "budget.maxNodes", { minimum: 1, maximum: MAX_BUDGET_NODES }),
    maxMilliseconds: finiteInteger(budget.maxMilliseconds, "budget.maxMilliseconds", { minimum: 1, maximum: MAX_BUDGET_MILLISECONDS }),
  };
}

/** Normalize and bound a start command before it crosses the worker boundary. */
export function createSearchRequest(input) {
  const source = requireObject(input, "start command");
  if (source.type !== "start") throw new WorkerProtocolError("INVALID_COMMAND", "Expected a start command.");
  if (source.protocolVersion !== WORKER_PROTOCOL_VERSION) {
    throw new WorkerProtocolError("PROTOCOL_MISMATCH", `Expected worker protocol ${WORKER_PROTOCOL_VERSION}.`, {
      received: source.protocolVersion,
    });
  }

  const presetFingerprint = requireString(source.presetFingerprint, "presetFingerprint");
  const request = {
    type: "start",
    protocolVersion: WORKER_PROTOCOL_VERSION,
    requestId: requireString(source.requestId, "requestId", MAX_REQUEST_ID_LENGTH),
    presetFingerprint,
    catalogRevision: requireString(source.catalogRevision, "catalogRevision"),
    seed: requireString(source.seed, "seed", MAX_SEED_LENGTH),
    ticket: normalizeTicket(source.ticket, presetFingerprint),
    cursor: normalizeCursor(source.cursor),
    budget: normalizeBudget(source.budget),
    pieces: normalizePieces(source.pieces),
    constraints: cloneJson(source.constraints ?? {}, "constraints"),
    steering: cloneJson(source.steering ?? {}, "steering"),
    knownSignatureHints: normalizeHints(source.knownSignatureHints),
  };

  const bytes = byteLength(request);
  if (bytes > MAX_REQUEST_BYTES) {
    throw new WorkerProtocolError("REQUEST_PAYLOAD_LIMIT", `Search request exceeds ${MAX_REQUEST_BYTES} bytes.`, {
      bytes,
      maximum: MAX_REQUEST_BYTES,
    });
  }
  return { ...request, payloadBytes: bytes };
}

function normalizeProgress(progress = {}) {
  const value = requireObject(progress, "progress");
  return {
    nodes: finiteInteger(value.nodes ?? 0, "progress.nodes"),
    depth: finiteInteger(value.depth ?? 0, "progress.depth"),
    frontier: finiteInteger(value.frontier ?? 0, "progress.frontier"),
    families: finiteInteger(value.families ?? 0, "progress.families"),
    cursor: normalizeCursor(value.cursor),
  };
}

function normalizeResult(result) {
  if (result == null) return null;
  const normalized = cloneJson(result, "result");
  if (!Array.isArray(normalized.placements)) {
    throw new WorkerProtocolError("INVALID_RESULT", "A search result must contain a placements array.");
  }
  if (normalized.placements.length > MAX_PIECES) {
    throw new WorkerProtocolError("RESULT_PAYLOAD_LIMIT", `A result cannot contain more than ${MAX_PIECES} placements.`);
  }
  const bytes = byteLength(normalized);
  if (bytes > MAX_RESULT_BYTES) {
    throw new WorkerProtocolError("RESULT_PAYLOAD_LIMIT", `Search result exceeds ${MAX_RESULT_BYTES} bytes.`, {
      bytes,
      maximum: MAX_RESULT_BYTES,
    });
  }
  return normalized;
}

function protocolError(error, fallbackCode = "WORKER_EXECUTION_FAILED") {
  if (error instanceof WorkerProtocolError) return error;
  return new WorkerProtocolError(fallbackCode, error?.message || String(error), { cause: error?.stack });
}

/**
 * Create the message runtime used by a Worker entrypoint.
 *
 * `execute(request, context)` must be async/cooperative. It should yield
 * between search batches and check `context.isCancelled()`; only then can a
 * cancel command receive its `cancelled` acknowledgement before completion.
 */
export function createWorkerRuntime({ postMessage, execute }) {
  if (typeof postMessage !== "function" || typeof execute !== "function") {
    throw new TypeError("postMessage and execute functions are required.");
  }

  let sequence = 0;
  let active = null;

  const emit = (run, type, payload = {}) => {
    postMessage({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: run?.request.requestId ?? null,
      ticket: run?.request.ticket ?? null,
      cursor: run?.cursor ?? null,
      type,
      sequence: ++sequence,
      ...payload,
    });
  };

  const fail = (requestId, error, phase = "protocol", run = null) => {
    const normalized = protocolError(error);
    postMessage({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId,
      ticket: run?.request.ticket ?? null,
      cursor: run?.cursor ?? null,
      type: "failed",
      sequence: ++sequence,
      phase,
      error: {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
        retryable: normalized.code !== "PROTOCOL_MISMATCH",
      },
    });
  };

  async function handleMessage(command) {
    if (!command || typeof command !== "object") {
      fail(null, new WorkerProtocolError("INVALID_COMMAND", "Worker command must be an object."));
      return;
    }

    if (command.type === "cancel") {
      if (typeof command.requestId !== "string" || command.requestId.length === 0) {
        fail(command.requestId ?? null, new WorkerProtocolError("INVALID_COMMAND", "Cancel requires a requestId."));
        return;
      }
      if (!active || active.request.requestId !== command.requestId) {
        fail(command.requestId, new WorkerProtocolError("NO_ACTIVE_REQUEST", "No active request matches the cancellation."));
        return;
      }
      active.cancelled = true;
      active.cancelReason = typeof command.reason === "string" ? command.reason.slice(0, 256) : "requested";
      return;
    }

    if (command.type !== "start") {
      fail(command.requestId ?? null, new WorkerProtocolError("INVALID_COMMAND", `Unsupported worker command: ${String(command.type)}.`));
      return;
    }

    let request;
    try {
      request = createSearchRequest(command);
    } catch (error) {
      fail(command.requestId ?? null, error);
      return;
    }
    if (active) {
      fail(request.requestId, new WorkerProtocolError("BUSY", "A search request is already active."));
      return;
    }

    const run = { request, cursor: request.cursor, cancelled: false, cancelReason: null };
    active = run;
    emit(run, "started", { budget: request.budget, payloadBytes: request.payloadBytes });

    const context = {
      isCancelled: () => active === run && run.cancelled,
      reportProgress: (progress) => {
        if (active !== run || run.cancelled) return;
        const normalized = normalizeProgress(progress);
        run.cursor = normalized.cursor;
        emit(run, "progress", normalized);
      },
    };

    try {
      const result = await execute(request, context);
      if (active !== run) return;
      if (run.cancelled) {
        emit(run, "cancelled", { reason: run.cancelReason || "requested" });
      } else {
        const normalized = normalizeResult(result);
        if (normalized) emit(run, "result", normalized);
        emit(run, "completed", { nodes: normalized?.nodes ?? 0 });
      }
    } catch (error) {
      if (active === run && run.cancelled) emit(run, "cancelled", { reason: run.cancelReason || "requested" });
      else if (active === run) fail(run.request.requestId, error, "execute", run);
    } finally {
      if (active === run) active = null;
    }
  }

  return { handleMessage, getActiveRequestId: () => active?.request.requestId ?? null };
}
