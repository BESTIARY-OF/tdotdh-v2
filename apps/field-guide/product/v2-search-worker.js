import { installCpuWorker } from '../../../packages/search-worker/src/cpu-worker-entry.js';
import { createWebGpuCandidatePrefilter } from '../../../packages/search-core/src/webgpu-candidate-prefilter.js';
import { search } from './v2-legacy-search.js';

const protocolHandle = installCpuWorker(self, { candidatePrefilter: createWebGpuCandidatePrefilter({ gpu: globalThis.navigator?.gpu }) });

self.onmessage = event => {
  const message = event?.data;
  if (message?.type === 'start' || message?.type === 'cancel') {
    void protocolHandle(message);
    return;
  }
  try {
    self.postMessage(search(message?.pieces, message?.knownCentroidFamilies || [], message || {}));
  } catch (error) {
    self.postMessage({ type: 'done', placements: null, metrics: null, nodes: 0, error: error.message });
  }
};
