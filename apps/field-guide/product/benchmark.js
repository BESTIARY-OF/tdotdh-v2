const output = document.querySelector('#output');
const runButton = document.querySelector('#run');
const workerUrl = new URL('./v2-search-worker.js?v=20260813-familyresident2', import.meta.url);

function signature(placements) {
  if (!Array.isArray(placements) || placements.length === 0) return null;
  return placements
    .slice()
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(placement => {
      const cells = (placement.cells || []).slice().sort((a, b) => a.y - b.y || a.x - b.x).map(cell => `${cell.x},${cell.y}`).join(';');
      return `${placement.id}@${placement.origin?.x},${placement.origin?.y}[${cells}]`;
    })
    .join('|');
}

async function loadFixture() {
  const source = await fetch('./app.js').then(response => response.text());
  const literal = source.match(/const SOURCE_SHAPES = (\{[\s\S]*?\n\});/)?.[1];
  if (!literal) throw new Error('SEDLEC source-shape fixture not found');
  const shapes = Function(`return ${literal}`)();
  const ids = [49, 43, 13, 26, 3, 4, 97, 9, 1, 21, 2, 6, 8, 24, 40];
  const locks = { 8: 'flip-x', 40: 'flip-xy', 43: 'flip-x' };
  return ids.map(id => ({ id, cells: shapes[id].map(([x, y]) => ({ x, y })), orientation: locks[id] || 'fixed' }));
}

function createProductRequest(pieces, backend, { cursor = { depth: 0, nodeOffset: 0, rootChoice: 0 }, requestId = `matched-${backend}-${Date.now()}`, familyId = `benchmark-${backend}` } = {}) {
  const diagnostic = new URL(location.href).searchParams.get('diagnostic');
  const diagnosticSteering = diagnostic === 'no-topology' ? { disableGpuCandidateTopology: true } : diagnostic === 'no-geometry' ? { disableGpuCandidateGeometry: true } : diagnostic === 'no-field-metrics' ? { disableGpuCandidateFieldMetrics: true } : diagnostic === 'no-target-pool' ? { disableGpuTargetPool: true } : diagnostic === 'no-target-generation' ? { disableGpuCandidateGeneration: true } : diagnostic === 'no-resident-navigation' ? { disableGpuResidentNavigation: true } : diagnostic === 'verify-resident-navigation' ? { verifyGpuResidentNavigation: true, captureGpuResidentDiagnostics: true } : diagnostic === 'resident-digest' ? { enableGpuResidentDigestConsumer: true } : diagnostic === 'verify-resident-state' ? { verifyGpuTransitionParity: true, enableGpuResidentDigestConsumer: true } : diagnostic === 'no-state-parity' ? { verifyGpuTransitionParity: false } : {};
  return {
    type: 'start',
    protocolVersion: 1,
    requestId,
    presetFingerprint: 'SEDLEC-00Q_ISLAND-001',
    catalogRevision: 'tdotdh-v2-benchmark',
    seed: 'matched-sedlec-benchmark',
    mode: 'breadth',
    operation: 'product-search',
    ticket: { presetFingerprint: 'SEDLEC-00Q_ISLAND-001', familyId, pass: 0, rootChoice: cursor.rootChoice || 0, threadId: 0 },
    cursor,
    budget: { maxNodes: 40000, maxMilliseconds: 900000 },
    pieces,
    constraints: {},
    steering: { searchStrategy: 'breadth', benchmarkBackend: backend === 'cpu' ? 'cpu' : 'gpu', ...diagnosticSteering },
    knownSignatureHints: [],
  };
}

function runWorker(pieces, backend, onProgress = () => {}, options = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { type: 'module' });
    const started = performance.now();
    let progress = null;
    let lastResult = null;
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error(`${backend} worker timed out`));
    }, 16 * 60 * 1000);
    worker.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'progress') {
        progress = { nodes: message.nodes, depth: message.depth, frontier: message.frontier };
        onProgress(progress);
        return;
      }
      if (message.type === 'result') {
        lastResult = message;
        return;
      }
      if (message.type !== 'completed' && message.type !== 'failed' && message.type !== 'cancelled') return;
      clearTimeout(timeout);
      worker.terminate();
      resolve({
        backend,
        elapsedMs: Number((performance.now() - started).toFixed(2)),
        type: lastResult?.type || message.type,
        error: message.error || null,
        nodes: lastResult?.nodes || message.nodes || 0,
        progress,
        placements: Array.isArray(lastResult?.placements) ? lastResult.placements : null,
        signature: signature(lastResult?.placements),
        frontierState: lastResult?.frontierState || null,
        navigation: lastResult?.navigation || null,
        cursor: message.cursor || null,
        searchReceipt: lastResult?.searchReceipt || message.searchReceipt || null,
        stageReceipts: lastResult ? {
          frontier: lastResult.frontier || null,
          frontierMetrics: lastResult.frontierMetrics || null,
          fieldMetrics: lastResult.fieldMetrics || null,
          frontierTargetGeneration: lastResult.frontierTargetGeneration || null,
          frontierTargetPool: lastResult.frontierTargetPool || null,
          navigationPlan: lastResult.navigationPlan || null,
          frontierScore: lastResult.frontierScore || null,
          frontierRanker: lastResult.frontierRanker || null,
          frontierCompactor: lastResult.frontierCompactor || null,
          frontierDedup: lastResult.frontierDedup || null,
          frontierTopology: lastResult.frontierTopology || null,
          frontierState: lastResult.frontierState || null,
        } : null,
        gpuExecution: lastResult?.gpuExecution || null,
        stageTimings: lastResult?.stageTimings || null,
        familyBatch: lastResult?.familyBatch || null,
      });
    };
    worker.onerror = event => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(`${backend} worker error: ${event.message || 'unknown error'}`));
    };
    worker.postMessage(createProductRequest(pieces, backend, options));
  });
}

function runCancelledWorker(pieces) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { type: 'module' });
    const request = createProductRequest(pieces, 'gpu', { familyId: 'benchmark-cancel-resume' });
    let progressCount = 0, cancelSent = false;
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('cancelled worker timed out')); }, 16 * 60 * 1000);
    worker.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'progress') {
        progressCount += 1;
        if (!cancelSent && progressCount >= 2) { cancelSent = true; worker.postMessage({ type: 'cancel', requestId: request.requestId, reason: 'benchmark-cancel-resume' }); }
        return;
      }
      if (message.type === 'cancelled') {
        clearTimeout(timeout);
        worker.terminate();
        resolve({ type: message.type, reason: message.reason, nodes: message.searchReceipt?.nodes || 0, cursor: message.cursor, searchReceipt: message.searchReceipt, progressCount });
        return;
      }
      if (message.type === 'failed') { clearTimeout(timeout); worker.terminate(); reject(new Error(message.error?.message || 'cancelled worker failed')); }
    };
    worker.onerror = event => { clearTimeout(timeout); worker.terminate(); reject(new Error(event.message || 'cancelled worker error')); };
    worker.postMessage(request);
  });
}

async function runCancellationResume(pieces) {
  const cancelled = await runCancelledWorker(pieces);
  if (cancelled.type !== 'cancelled' || !cancelled.cursor?.checkpoint) throw new Error('cancelled run did not return a resumable checkpoint');
  const resumed = await runWorker(pieces, 'gpu', () => {}, { cursor: cancelled.cursor, familyId: 'benchmark-cancel-resume', requestId: `matched-gpu-resumed-${Date.now()}` });
  const baseline = await runWorker(pieces, 'gpu', () => {}, { familyId: 'benchmark-cancel-resume', requestId: `matched-gpu-baseline-${Date.now()}` });
  return {
    fixture: 'SEDLEC-00Q_ISLAND-001',
    cancelled: { type: cancelled.type, reason: cancelled.reason, nodes: cancelled.nodes, progressCount: cancelled.progressCount, cursor: cancelled.cursor, checkpoint: true },
    resumed: { type: resumed.type, nodes: resumed.nodes, elapsedMs: resumed.elapsedMs, signature: resumed.signature, cursor: resumed.cursor, cumulativeNodeOffset: resumed.cursor?.nodeOffset ?? null },
    baseline: { type: baseline.type, nodes: baseline.nodes, elapsedMs: baseline.elapsedMs, signature: baseline.signature },
    checks: {
      cancelledWithCheckpoint: Boolean(cancelled.cursor?.checkpoint),
      resumedCompleted: resumed.type === 'completed' || resumed.type === 'result',
      canonicalSignatureMatch: Boolean(resumed.signature && baseline.signature && resumed.signature === baseline.signature),
      nodeCountMatch: resumed.cursor?.nodeOffset === baseline.nodes,
    },
  };
}

function summarize(result) {
  return {
    backend: result.backend,
    type: result.type,
    elapsedMs: result.elapsedMs,
    nodes: result.nodes,
    progress: result.progress,
    foundArrangement: Array.isArray(result.placements) && result.placements.length > 0,
    canonicalSignature: result.signature,
    gpuExecution: result.gpuExecution,
    stageTimings: result.stageTimings,
    familyBatch: result.familyBatch,
    navigation: result.navigation,
    searchReceipt: result.searchReceipt,
    stageReceipts: result.stageReceipts,
    error: result.error,
  };
}

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  output.textContent = 'Loading the canonical SEDLEC fixture…';
  try {
    const pieces = await loadFixture();
    if (new URL(location.href).searchParams.get('mode') === 'cancel-resume') {
      output.textContent = 'Cancelling after progress, then resuming from the worker checkpoint…';
      output.textContent = JSON.stringify(await runCancellationResume(pieces), null, 2);
      return;
    }
    output.textContent = 'Running GPU worker, then forced CPU oracle…';
    const gpu = await runWorker(pieces, 'gpu', progress => {
      output.textContent = `GPU worker · depth ${progress.depth} · ${progress.nodes.toLocaleString()} nodes · frontier ${progress.frontier.toLocaleString()}`;
    });
    output.textContent = `GPU pass complete (${gpu.elapsedMs} ms). Running forced CPU oracle…`;
    const cpu = await runWorker(pieces, 'cpu', progress => {
      output.textContent = `CPU oracle · depth ${progress.depth} · ${progress.nodes.toLocaleString()} nodes · frontier ${progress.frontier.toLocaleString()}`;
    });
    output.textContent = JSON.stringify({
      fixture: 'SEDLEC-00Q_ISLAND-001',
      gpu: summarize(gpu),
      cpu: summarize(cpu),
      parity: {
        comparable: Boolean(gpu.signature && cpu.signature),
        canonicalSignatureMatch: Boolean(gpu.signature && cpu.signature && gpu.signature === cpu.signature),
        speedupCpuOverGpu: gpu.elapsedMs > 0 ? Number((cpu.elapsedMs / gpu.elapsedMs).toFixed(3)) : null,
      },
    }, null, 2);
  } catch (error) {
    output.textContent = JSON.stringify({ error: error.message }, null, 2);
  } finally {
    runButton.disabled = false;
  }
});
