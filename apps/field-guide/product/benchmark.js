const output = document.querySelector('#output');
const runButton = document.querySelector('#run');
const workerUrl = new URL('./v2-search-worker.js?v=20260811-matched92', import.meta.url);

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

function runWorker(pieces, backend, onProgress = () => {}) {
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
      });
    };
    worker.onerror = event => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(`${backend} worker error: ${event.message || 'unknown error'}`));
    };
    const diagnostic = new URL(location.href).searchParams.get('diagnostic');
    const diagnosticSteering = diagnostic === 'no-topology' ? { disableGpuCandidateTopology: true } : diagnostic === 'no-geometry' ? { disableGpuCandidateGeometry: true } : diagnostic === 'no-field-metrics' ? { disableGpuCandidateFieldMetrics: true } : diagnostic === 'no-target-pool' ? { disableGpuTargetPool: true } : diagnostic === 'no-target-generation' ? { disableGpuCandidateGeneration: true } : diagnostic === 'no-resident-navigation' ? { disableGpuResidentNavigation: true } : diagnostic === 'verify-resident-navigation' ? { verifyGpuResidentNavigation: true, captureGpuResidentDiagnostics: true } : diagnostic === 'no-state-parity' ? { verifyGpuTransitionParity: false } : {};
    worker.postMessage({
      type: 'start',
      protocolVersion: 1,
      requestId: `matched-${backend}-${Date.now()}`,
      presetFingerprint: 'SEDLEC-00Q_ISLAND-001',
      catalogRevision: 'tdotdh-v2-benchmark',
      seed: 'matched-sedlec-benchmark',
      mode: 'breadth',
      operation: 'product-search',
      ticket: { presetFingerprint: 'SEDLEC-00Q_ISLAND-001', familyId: `benchmark-${backend}`, pass: 0, rootChoice: 0, threadId: 0 },
      cursor: { depth: 0, nodeOffset: 0, rootChoice: 0 },
      budget: { maxNodes: 40000, maxMilliseconds: 900000 },
      pieces,
      constraints: {},
      steering: { searchStrategy: 'breadth', benchmarkBackend: backend, ...diagnosticSteering },
      knownSignatureHints: [],
    });
  });
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
