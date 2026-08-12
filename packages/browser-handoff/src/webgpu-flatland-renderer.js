export const WEBGPU_FLATLAND_RENDERER_SCHEMA = 'tdotdh.webgpu-flatland-renderer/v0';

const shader = /* wgsl */ `
struct Cell { coords: vec4<f32>, color: vec4<f32> };
struct Params { bounds: vec4<f32> };
@group(0) @binding(0) var<storage, read> cells: array<Cell>;
@group(0) @binding(1) var<uniform> params: Params;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(0.04, 0.04), vec2<f32>(0.96, 0.04), vec2<f32>(0.04, 0.96),
    vec2<f32>(0.04, 0.96), vec2<f32>(0.96, 0.04), vec2<f32>(0.96, 0.96)
  );
  let cell = cells[instanceIndex];
  let grid = max(params.bounds.zw, vec2<f32>(1.0, 1.0));
  let local = vec2<f32>(cell.coords.x, cell.coords.y) - params.bounds.xy + corners[vertexIndex];
  let clip = vec2<f32>(local.x / grid.x * 2.0 - 1.0, 1.0 - local.y / grid.y * 2.0);
  var output: VertexOutput;
  output.position = vec4<f32>(clip, 0.0, 1.0);
  output.color = cell.color;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return input.color;
}`;

function unavailable(reason) {
  return Object.freeze({ schema: WEBGPU_FLATLAND_RENDERER_SCHEMA, status: 'unavailable', backend: null, projection: 'flatland', reason });
}

function colorBytes(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
  if (!match) return [0.55, 0.65, 0.8, 0.92];
  const hex = match[1];
  return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255, 0.92];
}

function normalizeCells(cells) {
  if (!Array.isArray(cells) || cells.length === 0) throw new TypeError('WebGPU flatland renderer requires cells');
  return cells.map(cell => {
    if (!Number.isInteger(cell?.x) || !Number.isInteger(cell?.y)) throw new TypeError('WebGPU flatland cells require integer canonical coordinates');
    return { x: cell.x, y: cell.y, color: cell.color };
  });
}

export function createWebGpuFlatlandRenderer({ runtime = globalThis } = {}) {
  let devicePromise = null;
  let pipeline = null;
  let bindGroupLayout = null;

  async function getDevice() {
    const gpu = runtime?.navigator?.gpu;
    if (!gpu?.requestAdapter) return { device: null, reason: 'webgpu-unavailable' };
    if (!devicePromise) devicePromise = (async () => {
      const adapter = await gpu.requestAdapter();
      if (!adapter?.requestDevice) return { device: null, reason: 'webgpu-adapter-unavailable' };
      try { return { device: await adapter.requestDevice() }; }
      catch (error) { return { device: null, reason: `webgpu-device-unavailable:${error.message}` }; }
    })();
    return devicePromise;
  }

  async function render({ canvas, cells, bounds } = {}) {
    const normalized = normalizeCells(cells);
    if (!canvas?.getContext) return unavailable('canvas-unavailable');
    const { device, reason } = await getDevice();
    if (!device) return unavailable(reason);
    const context = canvas.getContext('webgpu');
    if (!context) return unavailable('webgpu-canvas-context-unavailable');
    const format = runtime.navigator.gpu.getPreferredCanvasFormat?.() || 'bgra8unorm';
    const width = Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 1));
    const height = Math.max(1, Math.floor(canvas.clientHeight || canvas.height || 1));
    canvas.width = width; canvas.height = height;
    context.configure({ device, format, alphaMode: 'premultiplied' });
    if (!pipeline) {
      const module = device.createShaderModule({ code: shader });
      bindGroupLayout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: 1, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: 1, buffer: { type: 'uniform' } },
      ] });
      pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
    }
    const data = new Float32Array(normalized.length * 8);
    normalized.forEach((cell, index) => {
      const offset = index * 8;
      data[offset] = cell.x; data[offset + 1] = cell.y;
      data.set(colorBytes(cell.color), offset + 4);
    });
    const cellBuffer = device.createBuffer({ size: data.byteLength, usage: 0x0080 | 0x0008 });
    device.queue.writeBuffer(cellBuffer, 0, data);
    const box = bounds || { minX: Math.min(...normalized.map(cell => cell.x)), minY: Math.min(...normalized.map(cell => cell.y)), width: 1, height: 1 };
    const params = new Float32Array([box.minX, box.minY, Math.max(1, box.width), Math.max(1, box.height)]);
    const paramBuffer = device.createBuffer({ size: params.byteLength, usage: 0x0040 | 0x0008 });
    device.queue.writeBuffer(paramBuffer, 0, params);
    const bindGroup = device.createBindGroup({ layout: bindGroupLayout, entries: [{ binding: 0, resource: { buffer: cellBuffer } }, { binding: 1, resource: { buffer: paramBuffer } }] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(6, normalized.length); pass.end();
    device.queue.submit([encoder.finish()]);
    return Object.freeze({ schema: WEBGPU_FLATLAND_RENDERER_SCHEMA, status: 'rendered', backend: 'webgpu', projection: 'flatland', cellCount: normalized.length });
  }

  return Object.freeze({
    schema: WEBGPU_FLATLAND_RENDERER_SCHEMA,
    availability: async () => { const result = await getDevice(); return result.device ? { schema: WEBGPU_FLATLAND_RENDERER_SCHEMA, status: 'available', backend: 'webgpu', projection: 'flatland' } : unavailable(result.reason); },
    render,
  });
}
