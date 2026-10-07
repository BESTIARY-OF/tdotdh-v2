# WebGPU runtime parity receipt

Date: 2026-08-10  
Product: apps/field-guide/product on http://127.0.0.1:5174/  
Browser: headless Google Chrome with WebGPU enabled through D3D11

## Results

- WebGPU capability probe: available.
- Candidate scorer dispatch: completed.
- Candidate scorer CPU/GPU hash parity: passed.
- Occupancy prefilter CPU/GPU validity-mask parity: passed.
- Candidate batch: 2,048 candidates, 276,480 cells.
- CPU prefilter: 51.4 ms.
- WebGPU prefilter: 30.9 ms.
- Accepted candidates: 2,048 on both backends.
- Runtime label: WebGPU occupancy parity verified; search still CPU-oracle.

The runtime receipt proves a real hardware-backed candidate scoring and
occupancy-prefilter slice. It does not yet prove that the entire variable-field
island search can run on the GPU. Canonical arrangement capture, ticketing,
cursor advancement, cancellation, and final signatures remain CPU-owned until
that larger parity gate is completed.

v1 and port 5173 were not accessed or modified.
