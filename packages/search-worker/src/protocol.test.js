import assert from "node:assert/strict";
import {
  MAX_SIGNATURE_HINTS,
  WORKER_PROTOCOL_VERSION,
  WorkerProtocolError,
  createSearchRequest,
  createWorkerRuntime,
} from "./protocol.js";

const baseCommand = {
  type: "start",
  protocolVersion: WORKER_PROTOCOL_VERSION,
  requestId: "search-1",
  presetFingerprint: "preset-a",
  catalogRevision: "catalog-1",
  seed: "seed-a",
  ticket: { presetFingerprint: "preset-a", familyId: "family-a", pass: 4, threadId: 2 },
  cursor: { depth: 0, nodeOffset: 0, rootChoice: 2 },
  budget: { maxNodes: 1000, maxMilliseconds: 1000 },
  pieces: [{ id: 3, cells: [{ x: 0, y: 0 }] }],
  constraints: { centroidId: 3 },
  steering: {},
  knownSignatureHints: ["known-a", "known-a", "known-b"],
};

const request = createSearchRequest(baseCommand);
assert.deepEqual(request.ticket, baseCommand.ticket);
assert.deepEqual(request.cursor, baseCommand.cursor);
assert.equal(request.knownSignatureHints.length, 2);
assert.equal(request.payloadBytes > 0, true);

assert.throws(
  () => createSearchRequest({ ...baseCommand, knownSignatureHints: Array.from({ length: MAX_SIGNATURE_HINTS + 1 }, (_, index) => `sig-${index}`) }),
  (error) => error instanceof WorkerProtocolError && error.code === "SIGNATURE_HINT_LIMIT",
);

const events = [];
let release;
const gate = new Promise((resolve) => { release = resolve; });
const runtime = createWorkerRuntime({
  postMessage: (event) => events.push(event),
  execute: async (_input, context) => {
    context.reportProgress({ nodes: 1, depth: 1, frontier: 2, families: 1, cursor: { depth: 1, nodeOffset: 1, rootChoice: 2 } });
    await gate;
    return context.isCancelled() ? null : { placements: [{ id: 3, cells: [{ x: 0, y: 0 }] }], nodes: 1 };
  },
});

const running = runtime.handleMessage(baseCommand);
await Promise.resolve();
assert.equal(runtime.getActiveRequestId(), "search-1");
await runtime.handleMessage({ type: "cancel", requestId: "search-1", reason: "test" });
release();
await running;

assert.deepEqual(events.map((event) => event.type), ["started", "progress", "cancelled"]);
assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
assert.deepEqual(events[1].ticket, baseCommand.ticket);
assert.deepEqual(events[1].cursor, { depth: 1, nodeOffset: 1, rootChoice: 2 });
assert.deepEqual(events[2].cursor, { depth: 1, nodeOffset: 1, rootChoice: 2 });
assert.equal(runtime.getActiveRequestId(), null);

const failed = [];
const idleRuntime = createWorkerRuntime({ postMessage: (event) => failed.push(event), execute: async () => null });
await idleRuntime.handleMessage({ type: "cancel", requestId: "missing" });
assert.equal(failed[0].type, "failed");
assert.equal(failed[0].error.code, "NO_ACTIVE_REQUEST");

console.log("search-worker protocol smoke test passed");
