const pipelineCaches = new WeakMap();

export function createWebGpuPipelineCache() {
  return Object.freeze({
    get(device, shaderSource, entryPoint = 'main') {
      if (!device || typeof device.createShaderModule !== 'function' || typeof device.createComputePipeline !== 'function') throw new TypeError('A WebGPU device is required');
      let cache = pipelineCaches.get(device);
      if (!cache) { cache = new Map(); pipelineCaches.set(device, cache); }
      const key = `${entryPoint}\u0000${shaderSource}`;
      let pipeline = cache.get(key);
      if (!pipeline) {
        const module = device.createShaderModule({ code: shaderSource });
        pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } });
        cache.set(key, pipeline);
      }
      return pipeline;
    },
  });
}
