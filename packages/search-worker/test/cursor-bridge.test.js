import assert from 'node:assert/strict';
import { protocolCursorToWorkCursor, workCursorToProtocolCursor } from '../src/cursor-bridge.js';

const ticket = { presetFingerprint: 'preset-v1', familyId: 'F-0RHDG0U', pass: 4, threadId: 2 };
const protocolCursor = { depth: 10, nodeOffset: 183, rootChoice: 7 };
const workCursor = protocolCursorToWorkCursor(protocolCursor, ticket, { runSeed: 'run-2026-08-10' });

assert.equal(workCursor.ticketKey, 'preset-v1/F-0RHDG0U/4/2');
assert.equal(workCursor.runSeed, 'run-2026-08-10');
assert.deepEqual(workCursorToProtocolCursor(workCursor), protocolCursor);
assert.equal(protocolCursorToWorkCursor(protocolCursor, ticket, { runSeed: 'run-2026-08-10', status: 'complete' }).status, 'complete');
assert.throws(() => protocolCursorToWorkCursor({ nodeOffset: -1 }, ticket), /nodeOffset/);
assert.throws(() => workCursorToProtocolCursor({ depth: 1, nodeCursor: 0 }), /branchCursor/);

console.log('cursor bridge tests passed');
