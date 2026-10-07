import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SENSORIUM_SCHEMA,
  SENSORIUM_SURFACES,
  assertOpaqueId,
  filterSensoriumDiscovery
} from '../src/sensorium-contract.js';

const NOW = '2026-10-07T12:00:00.000Z';
const FRESH = '2026-10-07T11:59:59.000Z';

function environment(surface, overrides = {}) {
  return {
    instanceId: 'env-' + surface + '-0001',
    surface,
    provider: surface,
    capabilities: ['observe', 'map'],
    observedAt: FRESH,
    privacy: 'session',
    ...overrides
  };
}

test('filters all supported adapters into one privacy-safe shape', () => {
  const discovery = filterSensoriumDiscovery({
    avatar: {
      profileId: 'avatar-red-0001',
      displayName: 'Red Qadence',
      capabilities: ['discover'],
      privacy: 'workspace',
      secretToken: 'must-not-cross'
    },
    environments: SENSORIUM_SURFACES.map(surface => environment(surface)),
    availableLenses: [{
      lensId: 'lens-island-0001',
      name: 'Island',
      allowedSurfaces: SENSORIUM_SURFACES,
      fields: ['instanceId', 'surface'],
      maxPrivacy: 'session',
      ttlMs: 10_000
    }]
  }, { now: NOW });

  assert.equal(discovery.schemaVersion, SENSORIUM_SCHEMA);
  assert.deepEqual(discovery.environments.map(item => item.surface).sort(), [...SENSORIUM_SURFACES].sort());
  assert.deepEqual(Object.keys(discovery.environments[0]).sort(), ['capabilities', 'instanceId', 'observedAt', 'privacy', 'provider', 'surface']);
  assert.equal(JSON.stringify(discovery).includes('must-not-cross'), false);
  assert.equal(JSON.stringify(discovery).includes('secretToken'), false);
});

test('redacts secret observations and omits expired observations', () => {
  const discovery = filterSensoriumDiscovery({
    environments: [
      environment('terminal', { instanceId: 'env-public-0001', privacy: 'public' }),
      environment('tmux', { instanceId: 'env-secret-0001', privacy: 'secret' }),
      environment('wmux', { instanceId: 'env-expired-0001', observedAt: '2026-10-07T11:00:00.000Z' })
    ]
  }, { now: NOW, defaultTtlMs: 10_000 });

  assert.deepEqual(discovery.environments.map(item => item.instanceId), ['env-public-0001']);
});

test('requires explicit parent disclosure for child environments', () => {
  const child = environment('vscode', {
    instanceId: 'env-child-0001',
    parentInstanceId: 'env-parent-0001'
  });
  const hidden = filterSensoriumDiscovery({ environments: [child] }, { now: NOW });
  assert.equal(hidden.environments.length, 0);

  const visible = filterSensoriumDiscovery({ environments: [child] }, {
    now: NOW,
    allowedParentInstanceIds: ['env-parent-0001']
  });
  assert.equal(visible.environments[0].parentInstanceId, 'env-parent-0001');
});

test('rejects malformed and duplicate opaque identifiers', () => {
  assert.throws(() => assertOpaqueId('x'), /opaque identifier/);
  assert.throws(() => filterSensoriumDiscovery({
    environments: [
      environment('terminal', { instanceId: 'env-duplicate-0001' }),
      environment('tmux', { instanceId: 'env-duplicate-0001' })
    ]
  }, { now: NOW }), /instanceId values must be unique/);
});

test('expired discovery envelope returns a structurally valid empty result', () => {
  const discovery = filterSensoriumDiscovery({
    generatedAt: '2026-10-07T10:00:00.000Z',
    expiresAt: '2026-10-07T11:00:00.000Z',
    environments: [environment('terminal')]
  }, { now: NOW });

  assert.deepEqual(discovery, {
    schemaVersion: SENSORIUM_SCHEMA,
    generatedAt: '2026-10-07T10:00:00.000Z',
    expiresAt: '2026-10-07T11:00:00.000Z',
    environments: [],
    availableLenses: []
  });
});
