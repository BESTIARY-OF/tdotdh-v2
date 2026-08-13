import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const workerPath = pathToFileURL(resolve('apps/field-guide/product/v2-search-worker.js')).href;
const wrapper = `
  const { parentPort } = require('node:worker_threads');
  globalThis.self = { postMessage: message => parentPort.postMessage(message) };
  const pending = [];
  parentPort.on('message', message => {
    if (typeof globalThis.self.onmessage === 'function') globalThis.self.onmessage({ data: message });
    else pending.push(message);
  });
  (async () => {
    await import(${JSON.stringify(workerPath)});
    for (const message of pending.splice(0)) globalThis.self.onmessage({ data: message });
  })().catch(error => { parentPort.postMessage({ type: 'boot-error', message: error.message }); });
`;
const cells = Array.from({ length: 9 }, (_, index) => ({ x: index % 3, y: Math.floor(index / 3) }));
const request = {
  type: 'start',
  protocolVersion: 1,
  requestId: 'worker-runtime-test',
  presetFingerprint: 'test-preset',
  catalogRevision: 'field-guide:test:v2',
  seed: 'runtime-test',
  mode: 'depth',
  operation: 'product-search',
  ticket: { presetFingerprint: 'test-preset', familyId: 'open', pass: 0, threadId: 0 },
  cursor: { depth: 0, nodeOffset: 0, rootChoice: 0 },
  budget: { maxNodes: 1000, maxMilliseconds: 10000 },
  pieces: [{ id: 3, cells }, { id: 1, cells }, { id: 2, cells }, { id: 4, cells }],
  knownSignatureHints: [],
  steering: { centroidId: 3, knownCentroidFamilies: [], searchStrategy: 'depth', positionLocks: { 1: { dx: -3, dy: 0 }, 2: { dx: 3, dy: 0 } } },
};

const worker = new Worker(wrapper, { eval: true });
const events = [];
const result = await new Promise((resolveResult, reject) => {
  const timer = setTimeout(() => reject(new Error('product worker runtime test timed out')), 15000);
  worker.on('message', event => {
    events.push(event);
    if (event.type === 'result') {
      clearTimeout(timer);
      resolveResult(event);
    }
    if (event.type === 'failed') {
      clearTimeout(timer);
      reject(new Error(event.error?.message || 'product worker failed'));
    }
  });
  worker.on('error', error => { clearTimeout(timer); reject(error); });
  worker.postMessage(request);
});
await worker.terminate();

const batchRequest = {
  ...request,
  requestId: 'worker-family-grid-test',
  steering: {
    ...request.steering,
    familyWorkPlan: [
      { taskId: 'F-A:0', familyId: 'F-A', seed: '#01[0,0>1,0]', weight: 3, threadIndex: 0 },
      { taskId: 'F-B:0', familyId: 'F-B', seed: '#02[0,0>-1,0]', weight: 5, threadIndex: 0 },
    ],
  },
};
const batchWorker = new Worker(wrapper, { eval: true });
const batchResult = await new Promise((resolveBatch, rejectBatch) => {
  const timer = setTimeout(() => rejectBatch(new Error('family-grid worker runtime test timed out')), 15000);
  batchWorker.on('message', event => {
    if (event.type === 'result') { clearTimeout(timer); resolveBatch(event); }
    if (event.type === 'failed') { clearTimeout(timer); rejectBatch(new Error(event.error?.message || 'family-grid worker failed')); }
  });
  batchWorker.on('error', error => { clearTimeout(timer); rejectBatch(error); });
  batchWorker.postMessage(batchRequest);
});
await batchWorker.terminate();
assert.equal(batchResult.familyBatch.schema, 'tdotdh.v2.family-work-grid.v0');
assert.equal(batchResult.familyBatch.parallel, true);
assert.equal(batchResult.familyBatch.taskCount, 2);
assert.equal(batchResult.familyBatch.familyCount, 2);
assert.equal(batchResult.familyBatch.weightSlots, 8);
assert.equal(batchResult.familyBatch.residency, 'fused-single-dispatch-frontier');
assert.equal(batchResult.familyBatch.fused, false);
assert.equal(typeof batchResult.familyBatch.fusedDiagnostics.barriers, 'number');
assert.equal(typeof batchResult.familyBatch.overlapFactor, 'number');
assert.equal(batchResult.familyBatchResults.length, 2);

assert.ok(events.some(event => event.type === 'started'));
assert.equal(result.protocolOperation, 'product-search');
assert.equal(result.gpuExecution.deviceAvailable, false);
assert.equal(result.gpuExecution.reason, 'webgpu-adapter-unavailable');
assert.equal(result.navigation.schema, 'tdotdh.navigation-coordinator.v0');
assert.equal(result.navigation.gpuExpansionComplete, false);
assert.equal(result.navigation.expansionOwnership, 'cpu-oracle-fallback');
assert.ok(result.navigation.cpuFallbackStages.length > 0);
assert.equal(result.navigation.gpuExecution.deviceAvailable, false);
assert.equal(result.navigation.ticket.threadId, 0);
assert.equal(result.navigation.canonicalReplay, result.placements.length ? 'verified' : 'not-run');
assert.ok(result.navigation.progressCount >= 1);
assert.ok(result.navigation.batchCount >= 1);
assert.ok(result.navigation.cancellationChecks >= 2);
assert.equal(result.navigation.cursor.rootChoice, 0);

const probeWorker = new Worker(wrapper, { eval: true });
const probe = await new Promise((resolveProbe, rejectProbe) => {
  const timer = setTimeout(() => rejectProbe(new Error('GPU probe timed out')), 5000);
  probeWorker.on('message', event => {
    if (event.type === 'gpu-probe') { clearTimeout(timer); resolveProbe(event); }
    if (event.type === 'gpu-probe-failed') { clearTimeout(timer); rejectProbe(new Error(event.error?.message || 'GPU probe failed')); }
  });
  probeWorker.on('error', error => { clearTimeout(timer); rejectProbe(error); });
  probeWorker.postMessage({ type: 'probe' });
});
await probeWorker.terminate();
assert.equal(probe.type, 'gpu-probe');
assert.equal(probe.gpuExecution.deviceAvailable, false);
assert.equal(probe.workerNavigatorGpu, false);
assert.equal(probe.stageAvailability.prefilter.status, 'unavailable');
console.log('v2 product worker runtime receipt passed');
