import assert from "node:assert/strict";
import { cadenceHeartbeat, planCadence } from "../src/cadence.js";

const plan = planCadence([
  { id: "fix", phase: "critical", writeScope: ["apps/field-guide"] },
  { id: "grid", phase: "sidecar", writeScope: ["packages/domain/test"] },
  { id: "search", phase: "sidecar", writeScope: ["packages/search-core/src"] },
  { id: "release", phase: "integration", writeScope: ["docs"] }
]);

assert.equal(plan.critical.id, "fix");
assert.equal(plan.sidecarBatches.length, 1);
assert.equal(cadenceHeartbeat(plan, { completed: ["fix"] }).next, "sidecar:0");
assert.equal(cadenceHeartbeat(plan, { completed: ["fix", "grid", "search"] }).next, "integration");
assert.throws(() => planCadence([
  { id: "a", phase: "sidecar", writeScope: ["same"] },
  { id: "b", phase: "sidecar", writeScope: ["same"] }
]), /overlapping sidecar/);

console.log("cadence scheduler smoke test passed");
