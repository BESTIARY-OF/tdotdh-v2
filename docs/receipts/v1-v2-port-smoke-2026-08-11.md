# v1/v2 local port smoke receipt — 2026-08-11

## Runtime action

The v1 artifact at
`C:\Users\victorb\code\wg\DSSCC\projects\TDOTDH\prototypes\web-designer-v1`
was found intact but had no listener on port 5173. A read-only runtime
restoration started a static `python -m http.server 5173` from that directory.
No v1 source files, v2 source files, or staging data were modified.

## Evidence

- Port 5173: listening on `::`, serving the v1 directory.
- Port 5174: listening on `127.0.0.1`, serving the v2 preview.
- Browser smoke at 5173 loaded the Nonomino field-guide page and exposed the
  expected TDOTDH product text.
- Browser smoke at 5174 retained the GPU parity status from the v2 product.

## Boundary

This restores local availability of the existing v1 artifact; it is not a
staging deployment and does not establish GPU-first completion.
