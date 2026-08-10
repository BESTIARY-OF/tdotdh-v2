# v2 product WebGPU runtime receipt — 2026-08-10

## Environment

- Entry point: `http://127.0.0.1:5174/`
- Browser: headless Chrome with `--enable-unsafe-webgpu`, `--use-angle=d3d11`, and `--disable-gpu-sandbox`
- v1 port 5173: not started or modified

## Observed

- `navigator.gpu`: present
- Candidate scorer availability: `available`, backend `webgpu`
- Candidate occupancy prefilter availability: `available`, backend `webgpu`
- Runtime UI: `V2 product · WebGPU occupancy parity verified · search still CPU-oracle`
- Product search: completed passes while the page remained responsive; no page errors

## Boundary

The receipt proves the browser-side scorer and occupancy prefilter can initialize and
pass their CPU parity checks. The full variable-field search remains CPU-oracle
controlled. The product search status did not claim full GPU search, and this receipt
does not claim that canonical full-topology parity has been achieved.
