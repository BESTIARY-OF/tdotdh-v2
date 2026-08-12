# GPU topology pipeline-cache receipt — 2026-08-11

The batched frontier-topology path now reuses the device-scoped pipeline cache
for its reduction, label propagation, label seed, and label-summary shaders.
Per-batch buffers, bind groups, readbacks, label passes, topology semantics,
and CPU parity verification remain unchanged. This removes repeated shader
module/pipeline creation without changing the GPU-resident search contract.

## Verification

- `node --check packages/search-core/src/webgpu-frontier-topology.js`
  passed.
- `node packages/search-core/test/webgpu-frontier-topology.test.js` passed.
- Full `npm test` passed.
- Three cache-busted live SEDLEC runs completed the same 3,348 nodes through
  depth 14 with exact canonical-signature parity:

  | sample | GPU | CPU | CPU-over-GPU | topology batch total |
  | --- | ---: | ---: | ---: | ---: |
  | cached pipeline 1 | 7,823.9 ms | 8,460.6 ms | 1.081x | 326.1 ms |
  | cached pipeline 2 | 7,825.2 ms | 8,907.8 ms | 1.138x | 356.1 ms |
  | cached pipeline 3 | 7,286.0 ms | 7,773.6 ms | 1.067x | 306.5 ms |

The measurements are adapter- and host-dependent, so they are evidence of a
repeatable parity-safe improvement on this supported machine, not a universal
hardware claim. The historical 111,979 ms regression remains absent.
