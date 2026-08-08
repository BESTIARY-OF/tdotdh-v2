import assert from 'node:assert/strict';
import {
  checkpointWorkCursor,
  completeWorkCursor,
  createWorkCursor,
  cursorMatchesTicket,
  deserializeWorkCursor,
  resumeWorkCursor,
  serializeWorkCursor,
} from '../src/work-cursor.js';

const ticket = { presetFingerprint: 'preset-v1', familyId: 'F-0RHDG0U', pass: 4, threadId: 2 };
const runSeed = 'run-2026-08-08';

const initial = createWorkCursor(ticket, { runSeed });
assert.equal(initial.ticketKey, 'preset-v1/F-0RHDG0U/4/2');
assert.deepEqual({ branchCursor: initial.branchCursor, depth: initial.depth, nodeCursor: initial.nodeCursor }, { branchCursor: 0, depth: 0, nodeCursor: 0 });
assert.equal(cursorMatchesTicket(initial, ticket, { runSeed }), true);
assert.equal(cursorMatchesTicket(initial, { ...ticket, threadId: 3 }, { runSeed }), false);

const checkpointed = checkpointWorkCursor(initial, { branchCursor: 7, depth: 10, nodeCursor: 183 });
assert.deepEqual({ branchCursor: checkpointed.branchCursor, depth: checkpointed.depth, nodeCursor: checkpointed.nodeCursor }, { branchCursor: 7, depth: 10, nodeCursor: 183 });
assert.equal(initial.branchCursor, 0, 'checkpointing must not mutate the prior cursor');

const restored = resumeWorkCursor(ticket, serializeWorkCursor(checkpointed), { runSeed });
assert.deepEqual(restored, { ...checkpointed, status: 'running' });
assert.deepEqual(deserializeWorkCursor(serializeWorkCursor(restored)), restored);
assert.deepEqual(resumeWorkCursor(ticket, null, { runSeed }), initial);

assert.throws(() => resumeWorkCursor({ ...ticket, familyId: 'F-other' }, checkpointed, { runSeed }), /different ticket or run seed/);
assert.throws(() => resumeWorkCursor(ticket, checkpointed, { runSeed: 'run-other' }), /different ticket or run seed/);
assert.throws(() => checkpointWorkCursor(completeWorkCursor(checkpointed), { branchCursor: 8 }), /complete work cursor/);
assert.throws(() => createWorkCursor(ticket, { branchCursor: -1 }), /branchCursor/);

console.log('work cursor tests passed');
