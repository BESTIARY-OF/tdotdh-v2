import { createWorkerRuntime } from './protocol.js';
import { runCpuOracleBatch } from './cpu-oracle-runner.js';

export function createCpuWorkerHandler({ postMessage } = {}) {
  if (typeof postMessage !== 'function') throw new TypeError('postMessage must be a function');
  const runtime = createWorkerRuntime({
    postMessage,
    execute: (request, context) => runCpuOracleBatch(request, context),
  });
  return runtime.handleMessage;
}

export function installCpuWorker(scope = globalThis) {
  if (!scope || typeof scope.postMessage !== 'function') throw new TypeError('worker scope must provide postMessage');
  const handleMessage = createCpuWorkerHandler({ postMessage: message => scope.postMessage(message) });
  scope.onmessage = event => { void handleMessage(event?.data); };
  return handleMessage;
}

if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function') {
  installCpuWorker(self);
}
