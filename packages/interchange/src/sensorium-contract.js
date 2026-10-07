export const SENSORIUM_SCHEMA = 'tdotdh.sensorium/v1';

export const SENSORIUM_SURFACES = Object.freeze([
  'terminal',
  'tmux',
  'wmux',
  'vscode',
  'agent-harness'
]);

export const SENSORIUM_PRIVACY_CLASSES = Object.freeze([
  'public',
  'workspace',
  'session',
  'secret'
]);

const PRIVACY_RANK = Object.freeze({
  public: 0,
  workspace: 1,
  session: 2,
  secret: 3
});

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const DEFAULT_TTL_MS = 30_000;

function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(name + ' must be an object');
  }
}

export function assertOpaqueId(value, name = 'id') {
  if (typeof value !== 'string' || !OPAQUE_ID_PATTERN.test(value)) {
    throw new TypeError(name + ' must be an opaque identifier');
  }
  return value;
}

export function assertSurface(value) {
  if (!SENSORIUM_SURFACES.includes(value)) {
    throw new TypeError('unsupported sensorium surface: ' + value);
  }
  return value;
}

export function assertPrivacyClass(value) {
  if (!SENSORIUM_PRIVACY_CLASSES.includes(value)) {
    throw new TypeError('unsupported privacy class: ' + value);
  }
  return value;
}

function copyCapabilities(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(name + ' must be a string array');
  }
  return [...new Set(value)].sort();
}

function parseTimestamp(value, name) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(name + ' must be an ISO timestamp');
  }
  return value;
}

function isVisiblePrivacy(privacy, maximumPrivacy) {
  return PRIVACY_RANK[privacy] <= PRIVACY_RANK[maximumPrivacy] && privacy !== 'secret';
}

function isFresh(observedAt, ttlMs, nowMs) {
  return Date.parse(observedAt) + ttlMs > nowMs;
}

function normalizeEnvironment(environment, options) {
  assertPlainObject(environment, 'environment');
  const instanceId = assertOpaqueId(environment.instanceId, 'environment.instanceId');
  const surface = assertSurface(environment.surface);
  const privacy = assertPrivacyClass(environment.privacy);
  const observedAt = parseTimestamp(environment.observedAt, 'environment.observedAt');
  const ttlMs = environment.ttlMs ?? options.defaultTtlMs;

  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new RangeError('environment.ttlMs must be a positive integer');
  }
  if (!isVisiblePrivacy(privacy, options.maximumPrivacy) || !isFresh(observedAt, ttlMs, options.nowMs)) {
    return null;
  }

  const parentInstanceId = environment.parentInstanceId === undefined
    ? undefined
    : assertOpaqueId(environment.parentInstanceId, 'environment.parentInstanceId');
  if (parentInstanceId && !options.allowedParentInstanceIds.has(parentInstanceId)) {
    return null;
  }

  const result = {
    instanceId,
    surface,
    capabilities: copyCapabilities(environment.capabilities, 'environment.capabilities'),
    observedAt,
    privacy
  };
  if (parentInstanceId) result.parentInstanceId = parentInstanceId;
  if (typeof environment.provider === 'string' && environment.provider.length > 0) {
    result.provider = environment.provider;
  }
  return result;
}

function normalizeAvatar(avatar) {
  if (avatar === undefined) return undefined;
  assertPlainObject(avatar, 'avatar');
  const profileId = assertOpaqueId(avatar.profileId, 'avatar.profileId');
  const privacy = assertPrivacyClass(avatar.privacy ?? 'session');
  if (privacy === 'secret') return undefined;

  const result = {
    profileId,
    capabilities: copyCapabilities(avatar.capabilities, 'avatar.capabilities')
  };
  if (typeof avatar.displayName === 'string' && avatar.displayName.length > 0) {
    result.displayName = avatar.displayName;
  }
  return result;
}

function normalizeLens(lens, maximumPrivacy) {
  assertPlainObject(lens, 'lens');
  const lensId = assertOpaqueId(lens.lensId, 'lens.lensId');
  const maxPrivacy = assertPrivacyClass(lens.maxPrivacy ?? 'session');
  if (!isVisiblePrivacy(maxPrivacy, maximumPrivacy)) return null;

  const version = lens.version ?? 1;
  const ttlMs = lens.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isInteger(version) || version < 1) throw new RangeError('lens.version must be positive');
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new RangeError('lens.ttlMs must be positive');

  const allowedSurfaces = lens.allowedSurfaces === undefined
    ? [...SENSORIUM_SURFACES]
    : [...new Set(lens.allowedSurfaces.map(assertSurface))].sort();
  const fields = lens.fields === undefined ? [] : copyCapabilities(lens.fields, 'lens.fields');

  return { lensId, name: typeof lens.name === 'string' ? lens.name : lensId, version, allowedSurfaces, fields, maxPrivacy, ttlMs };
}

function assertUniqueIds(items, field) {
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item[field])) throw new RangeError(field + ' values must be unique');
    ids.add(item[field]);
  }
}

export function filterSensoriumDiscovery(input, options = {}) {
  assertPlainObject(input, 'sensorium input');
  const nowMs = options.now === undefined ? Date.now() : new Date(options.now).getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError('options.now must be a valid date');
  const maximumPrivacy = options.maximumPrivacy ?? 'session';
  assertPrivacyClass(maximumPrivacy);
  const defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
  if (!Number.isInteger(defaultTtlMs) || defaultTtlMs <= 0) {
    throw new RangeError('options.defaultTtlMs must be a positive integer');
  }
  const allowedParentInstanceIds = new Set((options.allowedParentInstanceIds ?? []).map(id => assertOpaqueId(id, 'allowedParentInstanceId')));

  const environments = (input.environments ?? [])
    .map(environment => normalizeEnvironment(environment, { nowMs, maximumPrivacy, defaultTtlMs, allowedParentInstanceIds }))
    .filter(Boolean)
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  assertUniqueIds(environments, 'instanceId');

  const availableLenses = (input.availableLenses ?? [])
    .map(lens => normalizeLens(lens, maximumPrivacy))
    .filter(Boolean);
  assertUniqueIds(availableLenses, 'lensId');

  const generatedAt = input.generatedAt === undefined
    ? new Date(nowMs).toISOString()
    : parseTimestamp(input.generatedAt, 'generatedAt');
  const expiresAt = input.expiresAt === undefined
    ? new Date(nowMs + defaultTtlMs).toISOString()
    : parseTimestamp(input.expiresAt, 'expiresAt');

  if (Date.parse(expiresAt) <= nowMs) {
    return {
      schemaVersion: SENSORIUM_SCHEMA,
      generatedAt,
      expiresAt,
      environments: [],
      availableLenses: []
    };
  }

  const avatar = normalizeAvatar(input.avatar);
  const result = {
    schemaVersion: SENSORIUM_SCHEMA,
    generatedAt,
    expiresAt,
    environments,
    availableLenses
  };
  if (avatar) result.avatar = avatar;
  return result;
}
