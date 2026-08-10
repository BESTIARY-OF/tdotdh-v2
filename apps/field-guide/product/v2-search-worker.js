import { installCpuWorker } from '../../../packages/search-worker/src/cpu-worker-entry.js';
import { createWebGpuCandidatePrefilter } from '../../../packages/search-core/src/webgpu-candidate-prefilter.js';
import { createWebGpuFrontierValidator } from '../../../packages/search-core/src/webgpu-frontier-validator.js';
import { search } from './v2-legacy-search.js';

const candidatePrefilter = createWebGpuCandidatePrefilter({ gpu: globalThis.navigator?.gpu });
const frontierValidator = createWebGpuFrontierValidator({ gpu: globalThis.navigator?.gpu });
const protocolHandle = installCpuWorker(self, { candidatePrefilter, frontierValidator });

self.onmessage = event => {
  const message = event?.data;
  if (message?.type === 'start' || message?.type === 'cancel') {
    void protocolHandle(message);
    return;
  }
  try {
    void search(message?.pieces, message?.knownCentroidFamilies || [], { ...message, candidatePrefilter, frontierValidator })
      .then(result => self.postMessage(result))
      .catch(error => self.postMessage({ type: 'done', placements: null, metrics: null, nodes: 0, error: error.message }));
  } catch (error) {
    self.postMessage({ type: 'done', placements: null, metrics: null, nodes: 0, error: error.message });
  }
};
