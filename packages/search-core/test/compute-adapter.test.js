import assert from 'node:assert/strict';
import {
  createComputeSearchRequest,
  createCpuOracleFirstAdapter,
  createUnavailableComputeAdapter,
} from '../src/compute-adapter.js';
import { createWorkCursor } from '../src/work-cursor.js';

const ticket = { presetFingerprint: 'preset-v1', familyId: 'F-0RHDG0U', pass: 2, threadId: 1 };
const runSeed = 'run-2026-08-08';
const cursor = createWorkCursor(ticket, { runSeed, branchCursor: 3, depth: 6, nodeCursor: 12 });

for (const mode of ['breadth', 'depth']) {
  const request = createComputeSearchRequest({ mode, ticket, cursor, runSeed, knownSignatures: ['b', 'a', 'a'] });
  assert.equal(request.mode, mode);
  assert.equal(request.ticketKey, 'preset-v1/F-0RHDG0U/2/1');
  assert.equal(request.deterministicKey, 'run-2026-08-08:preset-v1/F-0RHDG0U/2/1');
  assert.deepEqual(request.knownSignatures, ['a', 'b']);
}

assert.throws(() => createComputeSearchRequest({ mode: 'balanced', ticket, cursor, runSeed }), /Unsupported search mode/);
assert.throws(() => createComputeSearchRequest({ mode: 'depth', ticket: { ...ticket, threadId: 9 }, cursor, runSeed }), /does not match/);

const unavailableAdapter = createUnavailableComputeAdapter('WebGPU not exposed');
assert.deepEqual(unavailableAdapter.availability(), { status: 'unavailable', backend: 'compute-shader', reason: 'WebGPU not exposed' });
assert.deepEqual(await unavailableAdapter.execute(), unavailableAdapter.availability());

let oracleInput;
const adapter = createCpuOracleFirstAdapter({
  cpuOracle: async request => {
    oracleInput = request;
    return { canonicalSignature: '#03[0,0]|#43[1,0]', placements: [{ id: 3 }, { id: 43 }] };
  },
});
const result = await adapter.execute({ mode: 'depth', ticket, cursor, runSeed });
assert.equal(result.status, 'completed');
assert.equal(result.backend, 'cpu-oracle');
assert.equal(result.mode, 'depth');
assert.equal(result.ticketKey, cursor.ticketKey);
assert.equal(result.canonicalSignature, '#03[0,0]|#43[1,0]');
assert.deepEqual(result.placements, [{ id: 3 }, { id: 43 }]);
assert.deepEqual(result.accelerator, { status: 'unavailable', backend: 'compute-shader', reason: 'compute-shader-unavailable' });
assert.equal(oracleInput.deterministicKey, 'run-2026-08-08:preset-v1/F-0RHDG0U/2/1');

await assert.rejects(() => adapter.execute({ mode: 'breadth', ticket, cursor, runSeed: 'different-run' }), /does not match/);
await assert.rejects(() => createCpuOracleFirstAdapter({ cpuOracle: async () => ({}) }).execute({ mode: 'breadth', ticket, cursor, runSeed }), /canonical arrangement signature/);

console.log('compute adapter tests passed');
