import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(here, '..', 'package-catalog.v0.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(here, '..', 'package-catalog.v0.schema.json'), 'utf8'));

assert.equal(catalog.schema, 'tdotdh.package-catalog.v0');
assert.equal(catalog.catalog_version, schema.properties.catalog_version.const);
assert.equal(catalog.compatibility.semantic_baseline, 'v1-field-guide-arrangement-semantics');
assert.ok(catalog.compatibility.required_contracts.includes('maps-of.field-guide-arrangement.v0'));

const ids = catalog.packages.map((entry) => entry.id);
assert.equal(new Set(ids).size, ids.length);
assert.deepEqual(ids, [
  'packages/domain',
  'packages/search-core',
  'packages/field-metrics',
  'packages/search-worker',
  'packages/persistence',
  'packages/interchange',
  'packages/browser-handoff',
  'apps/field-guide',
  'apps/solver-worker'
]);

for (const entry of catalog.packages) {
  assert.ok(entry.capabilities.length > 0, `${entry.id} must declare a capability`);
  assert.ok(Array.isArray(entry.requires));
  assert.ok(Array.isArray(entry.provides));
}

assert.equal(catalog.packages.find((entry) => entry.id === 'packages/interchange').provides[0], 'tdotdh.package-catalog.v0');
console.log(`package catalog v${catalog.catalog_version} valid: ${catalog.packages.length} entries`);
