import { createWorkerRuntime } from './protocol.js';
import { runCpuOracleBatch } from './cpu-oracle-runner.js';
import { runFrontierBatch } from './frontier-batch-executor.js';

export function createCpuWorkerHandler({ postMessage, candidatePrefilter = null, frontierValidator = null, operations = {} } = {}) {
  if (typeof postMessage !== 'function') throw new TypeError('postMessage must be a function');
  const customOperations = operations && typeof operations === 'object' ? operations : {};
  const runtime = createWorkerRuntime({
    postMessage,
    execute: (request, context) => {
      const customExecutor = customOperations[request.operation];
      if (typeof customExecutor === 'function') return customExecutor(request, context);
      return request.operation === 'frontier-batch'
        ? runFrontierBatch(request, { ...context, frontierValidator })
        : runCpuOracleBatch(request, { ...context, candidatePrefilter });
    },
  });
  return runtime.handleMessage;
}

export function installCpuWorker(scope = globalThis, { candidatePrefilter = null, frontierValidator = null, operations = {} } = {}) {
  if (!scope || typeof scope.postMessage !== 'function') throw new TypeError('worker scope must provide postMessage');
  const handleMessage = createCpuWorkerHandler({ postMessage: message => scope.postMessage(message), candidatePrefilter, frontierValidator, operations });
  scope.onmessage = event => { void handleMessage(event?.data); };
  return handleMessage;
}

if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function') {
  installCpuWorker(self);
}
