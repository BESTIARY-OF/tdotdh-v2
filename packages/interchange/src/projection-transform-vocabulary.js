/**
 * Declarative names for future flatland-to-manifold views.
 *
 * This module is vocabulary only. It deliberately contains no projection
 * math, renderer selection, GPU capability detection, or backend claim.
 */

export const PROJECTION_VOCABULARY_SCHEMA = "tdotdh.projection-transform.v1";
export const PROJECTION_STATUS = "vocabulary-only";

export const PROJECTION_TARGETS = Object.freeze({
  sphere: Object.freeze({
    id: "sphere",
    displayName: "sphere",
    family: "manifold",
    description: "A closed two-dimensional surface target for a flatland view."
  }),
  hypersphere: Object.freeze({
    id: "hypersphere",
    displayName: "hypersphere",
    family: "manifold",
    description: "A higher-dimensional spherical target for a future projection view."
  }),
  cube: Object.freeze({
    id: "cube",
    displayName: "cube",
    family: "polytope",
    description: "A six-faced volumetric target for a future projection view."
  }),
  hypercube: Object.freeze({
    id: "hypercube",
    displayName: "hypercube",
    family: "polytope",
    description: "A higher-dimensional cubical target for a future projection view."
  }),
  simplex: Object.freeze({
    id: "simplex",
    displayName: "simplex",
    family: "polytope",
    description: "A minimal-vertex polytope target for a future projection view."
  })
});

export const PROJECTION_TRANSFORMS = Object.freeze(
  Object.values(PROJECTION_TARGETS).map(target => Object.freeze({
    id: `flatland-to-${target.id}`,
    source: "flatland",
    target: target.id,
    status: PROJECTION_STATUS,
    backend: null
  }))
);

export function projectionTransform(id) {
  const descriptor = PROJECTION_TRANSFORMS.find(transform => transform.id === id);
  if (!descriptor) throw new TypeError(`unsupported projection transform: ${id}`);
  return descriptor;
}

export function validateProjectionDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object") {
    throw new TypeError("projection descriptor must be an object");
  }
  const transform = projectionTransform(descriptor.id);
  if (descriptor.source !== transform.source || descriptor.target !== transform.target) {
    throw new RangeError("projection descriptor source and target do not match its vocabulary ID");
  }
  if (descriptor.status !== PROJECTION_STATUS || descriptor.backend !== null) {
    throw new RangeError("projection descriptors must remain vocabulary-only until a backend is implemented");
  }
  return transform;
}
