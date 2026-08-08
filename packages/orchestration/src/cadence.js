const PHASES = new Set(["critical", "sidecar", "integration"]);

function assertPhase(phase) {
  if (!PHASES.has(phase)) throw new TypeError(`unknown cadence phase: ${phase}`);
}

function normalizeScope(scope) {
  if (!Array.isArray(scope) || scope.length === 0) throw new TypeError("writeScope must be a non-empty array");
  return [...new Set(scope.map(String))].sort();
}

export function planCadence(tasks, { maxParallel = 6 } = {}) {
  if (!Array.isArray(tasks)) throw new TypeError("tasks must be an array");
  if (!Number.isInteger(maxParallel) || maxParallel < 1) throw new RangeError("maxParallel must be positive");

  const normalized = tasks.map((task, index) => {
    if (!task || typeof task !== "object") throw new TypeError(`task ${index} must be an object`);
    const phase = task.phase ?? "sidecar";
    assertPhase(phase);
    return { id: String(task.id ?? index), phase, writeScope: normalizeScope(task.writeScope) };
  });

  const critical = normalized.filter((task) => task.phase === "critical");
  if (critical.length > 1) throw new Error("cadence allows only one critical-path task");

  const sidecars = normalized.filter((task) => task.phase === "sidecar");
  const seen = new Map();
  for (const task of sidecars) {
    for (const path of task.writeScope) {
      const owner = seen.get(path);
      if (owner) throw new Error(`overlapping sidecar write scope: ${path} (${owner} and ${task.id})`);
      seen.set(path, task.id);
    }
  }

  const batches = [];
  for (let i = 0; i < sidecars.length; i += maxParallel) batches.push(sidecars.slice(i, i + maxParallel));
  return {
    critical: critical[0] ?? null,
    sidecarBatches: batches,
    integration: normalized.filter((task) => task.phase === "integration"),
    rule: "critical -> sidecar batches -> integration"
  };
}

export function cadenceHeartbeat(plan, state = {}) {
  if (!plan || !Array.isArray(plan.sidecarBatches) || !Array.isArray(plan.integration)) {
    throw new TypeError("invalid cadence plan");
  }
  const completed = new Set(state.completed ?? []);
  const blocked = new Set(state.blocked ?? []);
  const currentBatch = plan.sidecarBatches.findIndex((batch) => batch.some((task) => !completed.has(task.id) && !blocked.has(task.id)));
  const sidecarsDone = currentBatch === -1;
  const criticalDone = !plan.critical || completed.has(plan.critical.id) || blocked.has(plan.critical.id);
  const integrationReady = criticalDone && sidecarsDone;
  return {
    next: !criticalDone ? "critical" : !sidecarsDone ? `sidecar:${currentBatch}` : integrationReady ? "integration" : "blocked",
    currentBatch,
    integrationReady,
    completed: [...completed].sort(),
    blocked: [...blocked].sort()
  };
}

export { PHASES };
