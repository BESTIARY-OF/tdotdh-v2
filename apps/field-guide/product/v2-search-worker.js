import { installCpuWorker } from '../../../packages/search-worker/src/cpu-worker-entry.js';
import { createWebGpuCandidatePrefilter } from '../../../packages/search-core/src/webgpu-candidate-prefilter.js';

installCpuWorker(self, { candidatePrefilter: createWebGpuCandidatePrefilter({ gpu: globalThis.navigator?.gpu }) });
