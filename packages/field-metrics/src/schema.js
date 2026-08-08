export const FIELD_METRICS_SCHEMA = "tdotdh.field-metrics/v2";
export const SEARCH_PROGRESS_SCHEMA = "tdotdh.search-progress/v2";

export function emptyMetrics() {
  return {
    schemaVersion: FIELD_METRICS_SCHEMA,
    validation: { status: "partial", complete: false, connected: false, holes: { count: 0, zero: true } },
    geometry: { area: 0, bounds: null, width: 0, height: 0, density: 0 },
    coastline: { edgeCount: 0, meanRadius: null, radialStdDev: null },
    inletRisk: { score: null, inletCells: 0, inletEdges: 0, peninsulaDepth: 0 },
    centroid: { id: null, familyId: null, enclosure: "open" },
    ranking: { baseScore: null, qualityScore: null, components: {} }
  };
}
