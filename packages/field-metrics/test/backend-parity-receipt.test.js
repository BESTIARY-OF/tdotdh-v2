import assert from "node:assert/strict";

const SIGNATURE_SCHEMA = "tdotdh.arrangement-signature/v1";
const PARITY_SCHEMA = "tdotdh.backend-parity/v1";

const CPU_PLACEMENTS = [
  { id: 3, cells: [{ x: 1, y: 1 }, { x: 0, y: 1 }] },
  { id: 8, cells: [{ x: 2, y: 0 }, { x: 2, y: 1 }] }
];

// Same geometry, deliberately different placement and cell order. A backend
// may enumerate candidates differently, but it must emit the same canonical
// arrangement signature before throughput is compared.
const ACCELERATOR_PLACEMENTS = [
  { id: 8, cells: [{ x: 2, y: 1 }, { x: 2, y: 0 }] },
  { id: 3, cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }] }
];

const DIVERGENT_ACCELERATOR_PLACEMENTS = [
  { id: 8, cells: [{ x: 2, y: 1 }, { x: 2, y: 0 }] },
  { id: 3, cells: [{ x: 0, y: 1 }, { x: 1, y: 0 }] }
];

function canonicalSignature(placements) {
  const cells = placements.flatMap(placement => placement.cells);
  const minX = Math.min(...cells.map(cell => cell.x));
  const minY = Math.min(...cells.map(cell => cell.y));
  return `${SIGNATURE_SCHEMA}:${placements
    .toSorted((a, b) => a.id - b.id)
    .map(placement => {
      const normalized = placement.cells
        .map(cell => `${cell.x - minX},${cell.y - minY}`)
        .toSorted();
      return `${placement.id}:${normalized.join(";")}`;
    })
    .join("|")}`;
}

function compareBackends(cpu, accelerator) {
  const signaturesMatch = cpu.signature === accelerator.signature;
  return {
    schemaVersion: PARITY_SCHEMA,
    signaturesMatch,
    throughputAccepted: signaturesMatch,
    rejection: signaturesMatch ? null : "canonical signatures differ"
  };
}

const cpu = { signature: canonicalSignature(CPU_PLACEMENTS), nodes: 1200, elapsedMs: 18 };
const accelerator = { signature: canonicalSignature(ACCELERATOR_PLACEMENTS), nodes: 180, elapsedMs: 4 };
const divergentAccelerator = { signature: canonicalSignature(DIVERGENT_ACCELERATOR_PLACEMENTS), nodes: 12, elapsedMs: 1 };

assert.equal(cpu.signature, accelerator.signature);
const matchingReceipt = compareBackends(cpu, accelerator);
assert.deepEqual(matchingReceipt, {
  schemaVersion: PARITY_SCHEMA,
  signaturesMatch: true,
  throughputAccepted: true,
  rejection: null
});

const divergentReceipt = compareBackends(cpu, divergentAccelerator);
assert.equal(divergentReceipt.signaturesMatch, false);
assert.equal(divergentReceipt.throughputAccepted, false);
assert.equal(divergentReceipt.rejection, "canonical signatures differ");
assert.equal(divergentAccelerator.nodes < accelerator.nodes, true);
assert.equal(divergentReceipt.throughputAccepted, false, "faster output cannot bypass the correctness gate");

const encodedReceipt = JSON.stringify({ matchingReceipt, divergentReceipt });
assert.equal(JSON.stringify(JSON.parse(encodedReceipt)), encodedReceipt, "parity receipt JSON must be byte-stable");
assert.equal(encodedReceipt.includes("Infinity"), false);
assert.equal(encodedReceipt.includes("NaN"), false);

console.log("backend parity receipt passed: signature equality gates throughput");
