import { createWorkerRuntime } from './protocol.js';
import { runCpuOracleBatch } from './cpu-oracle-runner.js';

export function createCpuWorkerHandler({ postMessage, candidatePrefilter = null } = {}) {
  if (typeof postMessage !== 'function') throw new TypeError('postMessage must be a function');
  const runtime = createWorkerRuntime({
    postMessage,
    execute: (request, context) => runCpuOracleBatch(request, { ...context, candidatePrefilter }),
  });
  return runtime.handleMessage;
}

export function installCpuWorker(scope = globalThis, { candidatePrefilter = null } = {}) {
  if (!scope || typeof scope.postMessage !== 'function') throw new TypeError('worker scope must provide postMessage');
  const handleMessage = createCpuWorkerHandler({ postMessage: message => scope.postMessage(message), candidatePrefilter });
  scope.onmessage = event => { void handleMessage(event?.data); };
  return handleMessage;
}

if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function') {
  installCpuWorker(self);
}
