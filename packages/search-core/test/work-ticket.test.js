import assert from 'node:assert/strict';
import { allocateWeightedTickets, ticketKey } from '../src/work-ticket.js';

const tickets = allocateWeightedTickets([
  { presetFingerprint: 'preset-v1', familyId: 'F-z', weight: 1 },
  { presetFingerprint: 'preset-v1', familyId: 'F-a', weight: 3 },
  { presetFingerprint: 'preset-v1', familyId: 'F-b', weight: 2 },
  { presetFingerprint: 'preset-v1', familyId: 'F-zero', weight: 0 },
], 7);

assert.deepEqual(tickets.map(ticket => `${ticket.familyId}:${ticket.threadId}`), [
  'F-a:0', 'F-b:0', 'F-z:0', 'F-a:1', 'F-b:1', 'F-a:2',
]);
assert.equal(ticketKey(tickets[3]), 'preset-v1/F-a/7/1');

console.log('work ticket tests passed');
