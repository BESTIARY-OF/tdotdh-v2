const AREA = 9;
const PIECE_IDS = [49, 43, 13, 26, 3, 4, 97, 9, 1, 21, 2, 6, 8, 24, 40];
const COLORS = ['#e6a883', '#95c9b7', '#efc77b', '#d58e94', '#d87056', '#9eb8d4', '#cbb38c', '#aabf74', '#bba2cf', '#dda96e', '#87b9b2', '#dd9475', '#b0c888', '#d3a8a0', '#9aafcc'];
const LOCKS = { 8: 'flip-x', 40: 'flip-xy', 43: 'flip-x' };

// These are the representatives emitted by the original v1 ShapeEnumerator
// at one-based IDs 1..100. They are canonicalized by ShapeTransforms across
// all four rotations and four reflections; the active preset records the
// requested orientation modifications when the solver places this subset.
// Permutation #43 is the user's corrected exception: it is X-flipped.
const SOURCE_SHAPES = {
  49: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[1,1],[2,1],[3,1]],
  43: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[1,1],[3,0],[1,2]],
  13: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[1,1],[-2,0],[-2,1]],
  26: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[1,1],[-1,-1],[2,1]],
  3: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[1,1],[1,-1],[0,2]],
  4: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[1,1],[-2,0],[-1,1]],
  97: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[-1,1],[-2,1],[-3,1]],
  9: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[1,1],[-2,0],[2,1]],
  1: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[1,1],[1,-1],[-2,0]],
  21: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[1,1],[-1,1],[-2,1]],
  2: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[1,1],[1,-1],[-1,1]],
  6: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[1,1],[-2,0],[0,2]],
  8: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[1,1],[-2,0],[3,0]],
  24: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[1,1],[-1,-1],[0,-2]],
  40: [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[1,1],[0,-2],[0,-3]]
};

const PRESET_STORAGE_KEY = 'tdotdh-bestiary-presets-v1';
const ACTIVE_PRESET_STORAGE_KEY = 'tdotdh-bestiary-active-preset-v1';
const PRESET_ID_PREFIX = 'SEDLEC-00Q_ISLAND-';
const PRESET_NAME = 'The Opinionated Set';
const PRESET_TRANSFORMS = ['fixed', 'rotate-90', 'rotate-180', 'rotate-270', 'flip-x', 'flip-y', 'flip-xy'];
const app = { pieces: [], selectedId: 3, centroidId: 3, preset: null, presetData: null, presetStore: null, placements: null, snapshots: [], selectedFamily: null, arrangementPinned: false, arrangementDisplayLimit: 24, lastFamilySelections: new Map(), familySteering: new Map(), familySteeringPass: 0, positionPreferences: new Map(), positionLocks: new Map(), preferenceEnabled: false, preferenceMode: 'rank', familySort: 'best', arrangementSort: 'best', neighborBandFilter: null, searchHints: false, searchStrategy: 'balanced', neighborTarget: null, coastBias: 1, gravityBias: 1, inletBias: 1, sidebarMode: 'pieces', topView: 'solver', nodes: 0, totalNodes: 0, completedPasses: 0, lastPersistedNodes: 0, progressEstimate: 'banked lower bound', solving: false, continuous: false, pass: 0, catalogCount: 100, searchWorker: null, searchTimer: null, searchCheckpoint: null };
const SNAPSHOT_STORAGE_KEY = 'tdotdh-bestiary-snapshots-v5';
const COLOR_STORAGE_KEY = 'tdotdh-bestiary-piece-colors-v1';
const POSITION_PREFERENCE_STORAGE_KEY = 'tdotdh-bestiary-position-preferences-v1';
const POSITION_LOCK_STORAGE_KEY = 'tdotdh-bestiary-position-locks-v1';
const FAMILY_STEERING_STORAGE_KEY = 'tdotdh-bestiary-family-steering-v1';
const SEARCH_PROGRESS_STORAGE_KEY = 'tdotdh-bestiary-search-progress-v1';

function defaultPresetDefinition() {
  return { id: 'SEDLEC-00Q_ISLAND-001', name: PRESET_NAME, catalog: 'TDOTDH-100', centroidId: 3, maxModifiedPieces: 3, pieces: PIECE_IDS.map(id => ({ permutation: id, transform: LOCKS[id] || 'fixed' })) };
}
function activePieceIds() { return app.preset?.pieces?.map(piece => Number(piece.permutation)) || PIECE_IDS; }
function activeCentroidId() { return Number(app.centroidId || app.preset?.centroidId || 3); }
function presetRecord(definition, data = {}) { return { definition, snapshots: Array.isArray(data.snapshots) ? data.snapshots : [], progress: data.progress && typeof data.progress === 'object' ? data.progress : null, positionPreferences: data.positionPreferences && typeof data.positionPreferences === 'object' ? data.positionPreferences : {}, positionLocks: data.positionLocks && typeof data.positionLocks === 'object' ? data.positionLocks : {}, familySteering: data.familySteering && typeof data.familySteering === 'object' ? data.familySteering : {}, searchSettings: data.searchSettings && typeof data.searchSettings === 'object' ? data.searchSettings : {} }; }
function readJsonStorage(storageKey, fallback) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value ?? fallback;
  } catch (error) {
    console.warn(`Stored data for ${storageKey} could not be read.`, error);
    return fallback;
  }
}
function initializePresetState() {
  const stored = readJsonStorage(PRESET_STORAGE_KEY, null), storeHasSnapshots = Boolean(stored?.presets && Object.values(stored.presets).some(record => Array.isArray(record?.snapshots) && record.snapshots.length)), legacySnapshots = storeHasSnapshots ? [] : readJsonStorage(SNAPSHOT_STORAGE_KEY, []), legacyProgress = readJsonStorage(SEARCH_PROGRESS_STORAGE_KEY, null), legacyPreferences = readJsonStorage(POSITION_PREFERENCE_STORAGE_KEY, {}), legacyLocks = readJsonStorage(POSITION_LOCK_STORAGE_KEY, {}), legacySteering = readJsonStorage(FAMILY_STEERING_STORAGE_KEY, {});
  const store = stored && typeof stored === 'object' && stored.presets ? stored : { version: 1, activeId: 'SEDLEC-00Q_ISLAND-001', nextIndex: 2, presets: {} };
  if (!store.presets['SEDLEC-00Q_ISLAND-001']) store.presets['SEDLEC-00Q_ISLAND-001'] = presetRecord(defaultPresetDefinition(), { snapshots: Array.isArray(legacySnapshots) ? legacySnapshots : [], progress: legacyProgress, positionPreferences: legacyPreferences, positionLocks: legacyLocks, familySteering: legacySteering });
  const requestedId = localStorage.getItem(ACTIVE_PRESET_STORAGE_KEY) || store.activeId || 'SEDLEC-00Q_ISLAND-001';
  const activeId = store.presets[requestedId] ? requestedId : 'SEDLEC-00Q_ISLAND-001';
  store.activeId = activeId; store.nextIndex = Math.max(Number(store.nextIndex) || 2, ...Object.keys(store.presets).map(id => Number(id.match(/-(\d+)$/)?.[1]) + 1 || 2));
  app.presetStore = store; app.presetData = store.presets[activeId]; app.preset = app.presetData.definition; app.centroidId = Number(app.preset.centroidId || 3); app.selectedId = app.centroidId;
}
function persistPresetStore() {
  if (!app.presetStore || !app.preset?.id) return false;
  app.presetStore.activeId = app.preset.id;
  app.presetStore.presets[app.preset.id] = app.presetData;
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(app.presetStore));
    localStorage.setItem(ACTIVE_PRESET_STORAGE_KEY, app.preset.id);
    return true;
  } catch (error) {
    console.warn('The preset bank could not be saved.', error);
    return false;
  }
}
function restoreSearchSettings() {
  const saved = app.presetData?.searchSettings || readJsonStorage('tdotdh-bestiary-search-settings-v1', {});
  if (['best', 'coast', 'density', 'central', 'enclosure', 'arrangements'].includes(saved.familySort)) app.familySort = saved.familySort;
  if (['best', 'hints', 'coast', 'density', 'enclosure', 'compact', 'radial', 'central', 'square', 'inlets'].includes(saved.arrangementSort)) app.arrangementSort = saved.arrangementSort;
  app.neighborBandFilter = saved.neighborBandFilter == null || saved.neighborBandFilter === '' ? null : [3, 4, 5, 6, 7, 8, 9, 10, 11].includes(Number(saved.neighborBandFilter)) ? Number(saved.neighborBandFilter) : null;
  if (saved.preferenceMode === 'rank' || saved.preferenceMode === 'only') app.preferenceMode = saved.preferenceMode;
  if (typeof saved.preferenceEnabled === 'boolean') app.preferenceEnabled = saved.preferenceEnabled;
  if (typeof saved.searchHints === 'boolean') app.searchHints = saved.searchHints;
  if (['breadth', 'balanced', 'depth'].includes(saved.searchStrategy)) app.searchStrategy = saved.searchStrategy;
  app.neighborTarget = saved.neighborTarget == null || saved.neighborTarget === '' ? null : [4, 5, 6, 7, 8, 9, 10, 11].includes(Number(saved.neighborTarget)) ? Number(saved.neighborTarget) : null;
  for (const name of ['coastBias', 'gravityBias', 'inletBias']) if ([0, 1, 2, 3, 4, 5].includes(Number(saved[name]))) app[name] = Number(saved[name]);
}
function persistSearchSettings() {
  const value = { familySort: app.familySort, arrangementSort: app.arrangementSort, neighborBandFilter: app.neighborBandFilter, preferenceEnabled: app.preferenceEnabled, preferenceMode: app.preferenceMode, searchHints: app.searchHints, searchStrategy: app.searchStrategy, neighborTarget: app.neighborTarget, coastBias: app.coastBias, gravityBias: app.gravityBias, inletBias: app.inletBias };
  app.presetData.searchSettings = value; persistPresetStore();
  try { localStorage.setItem('tdotdh-bestiary-search-settings-v1', JSON.stringify(value)); } catch (error) { console.warn('The search settings could not be saved.', error); }
}
function orientationLabel(transform) { return ({ 'flip-x': 'X-flipped', 'flip-y': 'Y-flipped', 'flip-xy': 'X + Y flipped', 'rotate-90': '90° rotated', 'rotate-180': '180° rotated', 'rotate-270': '270° rotated' }[transform] || 'fixed'); }
function modifiedPieceCount(definition = app.preset) { return definition.pieces.filter(piece => piece.transform !== 'fixed').length; }
function nextPresetId() { const index = Math.max(1, Number(app.presetStore?.nextIndex) || 1); if (app.presetStore) app.presetStore.nextIndex = index + 1; return `${PRESET_ID_PREFIX}${String(index).padStart(3, '0')}`; }
function forkPreset(patch) {
  const next = { ...app.preset, ...patch, pieces: (patch.pieces || app.preset.pieces).map(piece => ({ permutation: Number(piece.permutation), transform: PRESET_TRANSFORMS.includes(piece.transform) ? piece.transform : 'fixed' })) };
  const pieceIds = next.pieces.map(piece => piece.permutation);
  if (pieceIds.some(id => !SOURCE_SHAPES[id]) || new Set(pieceIds).size !== pieceIds.length) { toast('Preset pieces must be unique TDOTDH permutations.'); return false; }
  if (!next.pieces.some(piece => piece.permutation === Number(next.centroidId))) { toast('The centroid must be one of the preset pieces.'); return false; }
  if (modifiedPieceCount(next) > (next.maxModifiedPieces || 3)) { toast(`This preset allows at most ${next.maxModifiedPieces || 3} modified pieces.`); return false; }
  stopContinuousSearch('Search paused before preset fork');
  persistPresetStore();
  const id = nextPresetId(); next.id = id;
  app.preset = next; app.presetData = presetRecord(next, { searchSettings: app.presetData?.searchSettings }); app.presetStore.presets[id] = app.presetData; app.centroidId = Number(next.centroidId); app.selectedId = app.centroidId; app.pieces = createPieces(); app.snapshots = []; app.placements = null; app.totalNodes = 0; app.nodes = 0; app.completedPasses = 0; app.progressEstimate = 'new preset'; app.lastPersistedNodes = 0; app.selectedFamily = null; app.arrangementPinned = false; app.positionPreferences = new Map(); app.positionLocks = new Map(); app.familySteering = new Map(); app.sidebarMode = 'pieces'; persistPresetStore(); renderPresetIdentity(); renderPieceList(); renderBoard(); renderInspector(); renderSnapshots(); renderSidebarMode(); toast(`${next.name} forked as ${id}`); return true;
}
function renderPresetIdentity() { document.querySelectorAll('#presetName').forEach(node => { node.textContent = app.preset?.name || PRESET_NAME; }); const count = document.querySelector('#presetPieceCount'); if (count) count.textContent = activePieceIds().length; const centroidLabel = document.querySelector('#centroidLabel'); if (centroidLabel) centroidLabel.textContent = `#${String(activeCentroidId()).padStart(2, '0')}`; const subtitle = document.querySelector('#stageSubtitle'); if (subtitle && !app.placements) subtitle.textContent = `No rectangle is prescribed. Find a dense connected packing with zero internal holes and #${String(activeCentroidId()).padStart(2, '0')} away from every coast.`; }
// One-time recovery seed for the arrangements captured before persistence was
// added. Coordinates are normalized thumbnail-grid coordinates, grouped by ID.
const RECOVERED_SNAPSHOT_DATA = [
  '1:12,5;13,5;10,6;11,6;12,6;13,6;14,6;12,7;13,7|2:5,7;6,7;4,8;5,8;6,8;7,8;4,9;5,9;6,9|3:8,6;9,6;7,7;8,7;9,7;10,7;8,8;9,8;8,9|4:7,9;5,10;6,10;7,10;8,10;9,10;6,11;7,11;8,11|6:14,7;12,8;13,8;14,8;15,8;16,8;14,9;15,9;14,10|8:6,0;8,1;7,1;6,1;5,1;4,1;3,1;6,2;5,2|9:14,3;12,4;13,4;14,4;15,4;16,4;17,4;14,5;16,5|13:4,2;2,3;3,3;4,3;5,3;6,3;2,4;4,4;5,4|21:2,9;1,10;2,10;3,10;4,10;0,11;1,11;2,11;3,11|24:3,4;2,5;3,5;2,6;3,6;4,6;5,6;3,7;4,7|26:8,3;9,3;8,4;9,4;10,4;11,4;9,5;10,5;11,5|40:1,5;1,4;1,3;0,2;1,2;2,2;3,2;1,1;2,1|43:10,10;9,9;10,9;11,9;12,9;13,9;10,8;11,8;11,7|49:6,4;7,4;4,5;5,5;6,5;7,5;8,5;6,6;7,6|97:13,1;12,2;13,2;14,2;15,2;10,3;11,3;12,3;13,3',
  '1:4,1;5,1;2,2;3,2;4,2;5,2;6,2;4,3;5,3|2:5,6;6,6;4,7;5,7;6,7;7,7;4,8;5,8;6,8|3:8,5;9,5;7,6;8,6;9,6;10,6;8,7;9,7;8,8|4:6,10;4,11;5,11;6,11;7,11;8,11;5,12;6,12;7,12|6:11,9;9,10;10,10;11,10;12,10;13,10;11,11;12,11;11,12|8:13,4;15,5;14,5;13,5;12,5;11,5;10,5;13,6;12,6|9:11,0;9,1;10,1;11,1;12,1;13,1;14,1;11,2;13,2|13:7,8;5,9;6,9;7,9;8,9;9,9;5,10;7,10;8,10|21:3,4;2,5;3,5;4,5;5,5;1,6;2,6;3,6;4,6|24:1,1;0,2;1,2;0,3;1,3;2,3;3,3;1,4;2,4|26:7,1;8,1;7,2;8,2;9,2;10,2;8,3;9,3;10,3|40:2,12;2,11;2,10;1,9;2,9;3,9;4,9;2,8;3,8|43:10,9;9,8;10,8;11,8;12,8;13,8;10,7;11,7;11,6|49:6,3;7,3;4,4;5,4;6,4;7,4;8,4;6,5;7,5|97:12,2;11,3;12,3;13,3;14,3;9,4;10,4;11,4;12,4',
  '1:12,2;13,2;10,3;11,3;12,3;13,3;14,3;12,4;13,4|2:5,4;6,4;4,5;5,5;6,5;7,5;4,6;5,6;6,6|3:8,3;9,3;7,4;8,4;9,4;10,4;8,5;9,5;8,6|4:7,6;5,7;6,7;7,7;8,7;9,7;6,8;7,8;8,8|6:14,6;12,7;13,7;14,7;15,7;16,7;14,8;15,8;14,9|8:15,0;17,1;16,1;15,1;14,1;13,1;12,1;15,2;14,2|9:13,9;11,10;12,10;13,10;14,10;15,10;16,10;13,11;15,11|13:11,7;9,8;10,8;11,8;12,8;13,8;9,9;11,9;12,9|21:5,8;4,9;5,9;6,9;7,9;3,10;4,10;5,10;6,10|24:3,1;2,2;3,2;2,3;3,3;4,3;5,3;3,4;4,4|26:8,0;9,0;8,1;9,1;10,1;11,1;9,2;10,2;11,2|40:1,8;1,7;1,6;0,5;1,5;2,5;3,5;1,4;2,4|43:10,7;9,6;10,6;11,6;12,6;13,6;10,5;11,5;11,4|49:6,1;7,1;4,2;5,2;6,2;7,2;8,2;6,3;7,3|97:15,3;14,4;15,4;16,4;17,4;12,5;13,5;14,5;15,5',
  '1:12,4;13,4;10,5;11,5;12,5;13,5;14,5;12,6;13,6|2:5,6;6,6;4,7;5,7;6,7;7,7;4,8;5,8;6,8|3:8,5;9,5;7,6;8,6;9,6;10,6;8,7;9,7;8,8|4:7,8;5,9;6,9;7,9;8,9;9,9;6,10;7,10;8,10|6:14,6;12,7;13,7;14,7;15,7;16,7;14,8;15,8;14,9|8:15,9;17,10;16,10;15,10;14,10;13,10;12,10;15,11;14,11|9:14,2;12,3;13,3;14,3;15,3;16,3;17,3;14,4;16,4|13:4,1;2,2;3,2;4,2;5,2;6,2;2,3;4,3;5,3|21:2,8;1,9;2,9;3,9;4,9;0,10;1,10;2,10;3,10|24:3,3;2,4;3,4;2,5;3,5;4,5;5,5;3,6;4,6|26:8,2;9,2;8,3;9,3;10,3;11,3;9,4;10,4;11,4|40:1,4;1,3;1,2;0,1;1,1;2,1;3,1;1,0;2,0|43:10,9;9,8;10,8;11,8;12,8;13,8;10,7;11,7;11,6|49:6,3;7,3;4,4;5,4;6,4;7,4;8,4;6,5;7,5|97:13,0;12,1;13,1;14,1;15,1;10,2;11,2;12,2;13,2',
  '1:12,4;13,4;10,5;11,5;12,5;13,5;14,5;12,6;13,6|2:3,7;4,7;2,8;3,8;4,8;5,8;2,9;3,9;4,9|3:6,6;7,6;5,7;6,7;7,7;8,7;6,8;7,8;6,9|4:12,7;10,8;11,8;12,8;13,8;14,8;11,9;12,9;13,9|6:6,0;4,1;5,1;6,1;7,1;8,1;6,2;7,2;6,3|8:5,9;7,10;6,10;5,10;4,10;3,10;2,10;5,11;4,11|9:13,1;11,2;12,2;13,2;14,2;15,2;16,2;13,3;15,3|13:2,2;0,3;1,3;2,3;3,3;4,3;0,4;2,4;3,4|21:15,5;14,6;15,6;16,6;17,6;13,7;14,7;15,7;16,7|24:1,4;0,5;1,5;0,6;1,6;2,6;3,6;1,7;2,7|26:8,5;9,5;8,6;9,6;10,6;11,6;9,7;10,7;11,7|40:8,12;8,11;8,10;7,9;8,9;9,9;10,9;8,8;9,8|43:7,5;6,4;7,4;8,4;9,4;10,4;7,3;8,3;8,2|49:4,4;5,4;2,5;3,5;4,5;5,5;6,5;4,6;5,6|97:15,8;14,9;15,9;16,9;17,9;12,10;13,10;14,10;15,10',
  '1:13,3;14,3;11,4;12,4;13,4;14,4;15,4;13,5;14,5|2:4,3;5,3;3,4;4,4;5,4;6,4;3,5;4,5;5,5|3:7,2;8,2;6,3;7,3;8,3;9,3;7,4;8,4;7,5|4:14,0;12,1;13,1;14,1;15,1;16,1;13,2;14,2;15,2|6:20,0;18,1;19,1;20,1;21,1;22,1;20,2;21,2;20,3|8:6,5;8,6;7,6;6,6;5,6;4,6;3,6;6,7;5,7|9:19,3;17,4;18,4;19,4;20,4;21,4;22,4;19,5;21,5|13:20,5;18,6;19,6;20,6;21,6;22,6;18,7;20,7;21,7|21:17,1;16,2;17,2;18,2;19,2;15,3;16,3;17,3;18,3|24:2,0;1,1;2,1;1,2;2,2;3,2;4,2;2,3;3,3|26:9,1;10,1;9,2;10,2;11,2;12,2;10,3;11,3;12,3|40:9,8;9,7;9,6;8,5;9,5;10,5;11,5;9,4;10,4|43:1,8;0,7;1,7;2,7;3,7;4,7;1,6;2,6;2,5|49:5,0;6,0;3,1;4,1;5,1;6,1;7,1;5,2;6,2|97:16,4;15,5;16,5;17,5;18,5;13,6;14,6;15,6;16,6',
  '1:12,4;13,4;10,5;11,5;12,5;13,5;14,5;12,6;13,6|2:5,6;6,6;4,7;5,7;6,7;7,7;4,8;5,8;6,8|3:8,5;9,5;7,6;8,6;9,6;10,6;8,7;9,7;8,8|4:7,8;5,9;6,9;7,9;8,9;9,9;6,10;7,10;8,10|6:14,6;12,7;13,7;14,7;15,7;16,7;14,8;15,8;14,9|8:16,0;18,1;17,1;16,1;15,1;14,1;13,1;16,2;15,2|9:14,2;12,3;13,3;14,3;15,3;16,3;17,3;14,4;16,4|13:4,1;2,2;3,2;4,2;5,2;6,2;2,3;4,3;5,3|21:2,8;1,9;2,9;3,9;4,9;0,10;1,10;2,10;3,10|24:3,3;2,4;3,4;2,5;3,5;4,5;5,5;3,6;4,6|26:8,2;9,2;8,3;9,3;10,3;11,3;9,4;10,4;11,4|40:1,4;1,3;1,2;0,1;1,1;2,1;3,1;1,0;2,0|43:10,9;9,8;10,8;11,8;12,8;13,8;10,7;11,7;11,6|49:6,3;7,3;4,4;5,4;6,4;7,4;8,4;6,5;7,5|97:16,8;15,9;16,9;17,9;18,9;13,10;14,10;15,10;16,10',
  '1:12,4;13,4;10,5;11,5;12,5;13,5;14,5;12,6;13,6|2:3,7;4,7;2,8;3,8;4,8;5,8;2,9;3,9;4,9|3:6,6;7,6;5,7;6,7;7,7;8,7;6,8;7,8;6,9|4:12,7;10,8;11,8;12,8;13,8;14,8;11,9;12,9;13,9|6:15,1;13,2;14,2;15,2;16,2;17,2;15,3;16,3;15,4|8:5,9;7,10;6,10;5,10;4,10;3,10;2,10;5,11;4,11|9:7,0;5,1;6,1;7,1;8,1;9,1;10,1;7,2;9,2|13:2,2;0,3;1,3;2,3;3,3;4,3;0,4;2,4;3,4|21:15,5;14,6;15,6;16,6;17,6;13,7;14,7;15,7;16,7|24:1,4;0,5;1,5;0,6;1,6;2,6;3,6;1,7;2,7|26:8,5;9,5;8,6;9,6;10,6;11,6;9,7;10,7;11,7|40:8,12;8,11;8,10;7,9;8,9;9,9;10,9;8,8;9,8|43:7,5;6,4;7,4;8,4;9,4;10,4;7,3;8,3;8,2|49:4,4;5,4;2,5;3,5;4,5;5,5;6,5;4,6;5,6|97:15,8;14,9;15,9;16,9;17,9;12,10;13,10;14,10;15,10',
  '1:4,2;5,2;2,3;3,3;4,3;5,3;6,3;4,4;5,4|2:6,9;7,9;5,10;6,10;7,10;8,10;5,11;6,11;7,11|3:5,6;6,6;4,7;5,7;6,7;7,7;5,8;6,8;5,9|4:3,4;1,5;2,5;3,5;4,5;5,5;2,6;3,6;4,6|6:8,1;6,2;7,2;8,2;9,2;10,2;8,3;9,3;8,4|8:6,12;8,13;7,13;6,13;5,13;4,13;3,13;6,14;5,14|9:11,0;9,1;10,1;11,1;12,1;13,1;14,1;11,2;13,2|13:2,0;0,1;1,1;2,1;3,1;4,1;0,2;2,2;3,2|21:9,10;8,11;9,11;10,11;11,11;7,12;8,12;9,12;10,12|24:7,3;6,4;7,4;6,5;7,5;8,5;9,5;7,6;8,6|26:0,9;1,9;0,10;1,10;2,10;3,10;1,11;2,11;3,11|40:10,7;10,6;10,5;9,4;10,4;11,4;12,4;10,3;11,3|43:8,9;7,8;8,8;9,8;10,8;11,8;8,7;9,7;9,6|49:2,7;3,7;0,8;1,8;2,8;3,8;4,8;2,9;3,9|97:12,11;11,12;12,12;13,12;14,12;9,13;10,13;11,13;12,13',
  '1:9,8;10,8;7,9;8,9;9,9;10,9;11,9;9,10;10,10|2:2,10;3,10;1,11;2,11;3,11;4,11;1,12;2,12;3,12|3:5,9;6,9;4,10;5,10;6,10;7,10;5,11;6,11;5,12|4:4,12;2,13;3,13;4,13;5,13;6,13;3,14;4,14;5,14|6:10,2;8,3;9,3;10,3;11,3;12,3;10,4;11,4;10,5|8:6,0;8,1;7,1;6,1;5,1;4,1;3,1;6,2;5,2|9:11,12;9,13;10,13;11,13;12,13;13,13;14,13;11,14;13,14|13:4,2;2,3;3,3;4,3;5,3;6,3;2,4;4,4;5,4|21:3,4;2,5;3,5;4,5;5,5;1,6;2,6;3,6;4,6|24:9,4;8,5;9,5;8,6;9,6;10,6;11,6;9,7;10,7|26:5,6;6,6;5,7;6,7;7,7;8,7;6,8;7,8;8,8|40:1,5;1,4;1,3;0,2;1,2;2,2;3,2;1,1;2,1|43:7,13;6,12;7,12;8,12;9,12;10,12;7,11;8,11;8,10|49:3,7;4,7;1,8;2,8;3,8;4,8;5,8;3,9;4,9|97:12,9;11,10;12,10;13,10;14,10;9,11;10,11;11,11;12,11',
  '1:14,3;15,3;12,4;13,4;14,4;15,4;16,4;14,5;15,5|2:7,5;8,5;6,6;7,6;8,6;9,6;6,7;7,7;8,7|3:10,4;11,4;9,5;10,5;11,5;12,5;10,6;11,6;10,7|4:5,3;3,4;4,4;5,4;6,4;7,4;4,5;5,5;6,5|6:16,5;14,6;15,6;16,6;17,6;18,6;16,7;17,7;16,8|8:15,0;17,1;16,1;15,1;14,1;13,1;12,1;15,2;14,2|9:15,8;13,9;14,9;15,9;16,9;17,9;18,9;15,10;17,10|13:5,7;3,8;4,8;5,8;6,8;7,8;3,9;5,9;6,9|21:3,5;2,6;3,6;4,6;5,6;1,7;2,7;3,7;4,7|24:13,5;12,6;13,6;12,7;13,7;14,7;15,7;13,8;14,8|26:10,1;11,1;10,2;11,2;12,2;13,2;11,3;12,3;13,3|40:1,4;1,3;1,2;0,1;1,1;2,1;3,1;1,0;2,0|43:4,3;3,2;4,2;5,2;6,2;7,2;4,1;5,1;5,0|49:8,2;9,2;6,3;7,3;8,3;9,3;10,3;8,4;9,4|97:8,8;7,9;8,9;9,9;10,9;5,10;6,10;7,10;8,10',
  '1:13,0;14,0;11,1;12,1;13,1;14,1;15,1;13,2;14,2|2:13,6;14,6;12,7;13,7;14,7;15,7;12,8;13,8;14,8|3:12,3;13,3;11,4;12,4;13,4;14,4;12,5;13,5;12,6|4:16,4;14,5;15,5;16,5;17,5;18,5;15,6;16,6;17,6|6:5,0;3,1;4,1;5,1;6,1;7,1;5,2;6,2;5,3|8:20,3;22,4;21,4;20,4;19,4;18,4;17,4;20,5;19,5|9:18,6;16,7;17,7;18,7;19,7;20,7;21,7;18,8;20,8|13:4,4;2,5;3,5;4,5;5,5;6,5;2,6;4,6;5,6|21:7,2;6,3;7,3;8,3;9,3;5,4;6,4;7,4;8,4|24:10,0;9,1;10,1;9,2;10,2;11,2;12,2;10,3;11,3|26:7,6;8,6;7,7;8,7;9,7;10,7;8,8;9,8;10,8|40:1,7;1,6;1,5;0,4;1,4;2,4;3,4;1,3;2,3|43:15,4;14,3;15,3;16,3;17,3;18,3;15,2;16,2;16,1|49:9,4;10,4;7,5;8,5;9,5;10,5;11,5;9,6;10,6|97:3,6;2,7;3,7;4,7;5,7;0,8;1,8;2,8;3,8',
  '1:7,1;8,1;5,2;6,2;7,2;8,2;9,2;7,3;8,3|2:6,7;7,7;5,8;6,8;7,8;8,8;5,9;6,9;7,9|3:9,6;10,6;8,7;9,7;10,7;11,7;9,8;10,8;9,9|4:12,1;10,2;11,2;12,2;13,2;14,2;11,3;12,3;13,3|6:13,5;11,6;12,6;13,6;14,6;15,6;13,7;14,7;13,8|8:3,11;5,12;4,12;3,12;2,12;1,12;0,12;3,13;2,13|9:12,10;10,11;11,11;12,11;13,11;14,11;15,11;12,12;14,12|13:4,5;2,6;3,6;4,6;5,6;6,6;2,7;4,7;5,7|21:8,9;7,10;8,10;9,10;10,10;6,11;7,11;8,11;9,11|24:4,8;3,9;4,9;3,10;4,10;5,10;6,10;4,11;5,11|26:9,3;10,3;9,4;10,4;11,4;12,4;10,5;11,5;12,5|40:1,8;1,7;1,6;0,5;1,5;2,5;3,5;1,4;2,4|43:11,10;10,9;11,9;12,9;13,9;14,9;11,8;12,8;12,7|49:7,4;8,4;5,5;6,5;7,5;8,5;9,5;7,6;8,6|97:3,0;2,1;3,1;4,1;5,1;0,2;1,2;2,2;3,2',
  '1:10,2;11,2;8,3;9,3;10,3;11,3;12,3;10,4;11,4|2:10,8;11,8;9,9;10,9;11,9;12,9;9,10;10,10;11,10|3:9,5;10,5;8,6;9,6;10,6;11,6;9,7;10,7;9,8|4:13,6;11,7;12,7;13,7;14,7;15,7;12,8;13,8;14,8|6:2,9;0,10;1,10;2,10;3,10;4,10;2,11;3,11;2,12|8:9,0;11,1;10,1;9,1;8,1;7,1;6,1;9,2;8,2|9:10,11;8,12;9,12;10,12;11,12;12,12;13,12;10,13;12,13|13:4,4;2,5;3,5;4,5;5,5;6,5;2,6;4,6;5,6|21:13,9;12,10;13,10;14,10;15,10;11,11;12,11;13,11;14,11|24:7,2;6,3;7,3;6,4;7,4;8,4;9,4;7,5;8,5|26:4,8;5,8;4,9;5,9;6,9;7,9;5,10;6,10;7,10|40:1,7;1,6;1,5;0,4;1,4;2,4;3,4;1,3;2,3|43:12,6;11,5;12,5;13,5;14,5;15,5;12,4;13,4;13,3|49:6,6;7,6;4,7;5,7;6,7;7,7;8,7;6,8;7,8|97:4,11;3,12;4,12;5,12;6,12;1,13;2,13;3,13;4,13',
  '1:17,2;18,2;15,3;16,3;17,3;18,3;19,3;17,4;18,4|2:10,4;11,4;9,5;10,5;11,5;12,5;9,6;10,6;11,6|3:13,3;14,3;12,4;13,4;14,4;15,4;13,5;14,5;13,6|4:12,6;10,7;11,7;12,7;13,7;14,7;11,8;12,8;13,8|6:4,5;2,6;3,6;4,6;5,6;6,6;4,7;5,7;4,8|8:20,0;22,1;21,1;20,1;19,1;18,1;17,1;20,2;19,2|9:19,4;17,5;18,5;19,5;20,5;21,5;22,5;19,6;21,6|13:5,0;3,1;4,1;5,1;6,1;7,1;3,2;5,2;6,2|21:7,6;6,7;7,7;8,7;9,7;5,8;6,8;7,8;8,8|24:8,1;7,2;8,2;7,3;8,3;9,3;10,3;8,4;9,4|26:13,0;14,0;13,1;14,1;15,1;16,1;14,2;15,2;16,2|40:1,8;1,7;1,6;0,5;1,5;2,5;3,5;1,4;2,4|43:15,7;14,6;15,6;16,6;17,6;18,6;15,5;16,5;16,4|49:11,1;12,1;9,2;10,2;11,2;12,2;13,2;11,3;12,3|97:20,6;19,7;20,7;21,7;22,7;17,8;18,8;19,8;20,8',
  '1:18,2;19,2;16,3;17,3;18,3;19,3;20,3;18,4;19,4|2:11,4;12,4;10,5;11,5;12,5;13,5;10,6;11,6;12,6|3:14,3;15,3;13,4;14,4;15,4;16,4;14,5;15,5;14,6|4:13,6;11,7;12,7;13,7;14,7;15,7;12,8;13,8;14,8|6:4,4;2,5;3,5;4,5;5,5;6,5;4,6;5,6;4,7|8:21,0;23,1;22,1;21,1;20,1;19,1;18,1;21,2;20,2|9:20,6;18,7;19,7;20,7;21,7;22,7;23,7;20,8;22,8|13:6,0;4,1;5,1;6,1;7,1;8,1;4,2;6,2;7,2|21:7,5;6,6;7,6;8,6;9,6;5,7;6,7;7,7;8,7|24:8,2;7,3;8,3;7,4;8,4;9,4;10,4;8,5;9,5|26:14,0;15,0;14,1;15,1;16,1;17,1;15,2;16,2;17,2|40:1,7;1,6;1,5;0,4;1,4;2,4;3,4;1,3;2,3|43:16,7;15,6;16,6;17,6;18,6;19,6;16,5;17,5;17,4|49:12,1;13,1;10,2;11,2;12,2;13,2;14,2;12,3;13,3|97:21,3;20,4;21,4;22,4;23,4;18,5;19,5;20,5;21,5',
  '1:12,0;13,0;10,1;11,1;12,1;13,1;14,1;12,2;13,2|2:17,3;18,3;16,4;17,4;18,4;19,4;16,5;17,5;18,5|3:14,2;15,2;13,3;14,3;15,3;16,3;14,4;15,4;14,5|4:17,0;15,1;16,1;17,1;18,1;19,1;16,2;17,2;18,2|6:6,0;4,1;5,1;6,1;7,1;8,1;6,2;7,2;6,3|8:16,6;18,7;17,7;16,7;15,7;14,7;13,7;16,8;15,8|9:19,5;17,6;18,6;19,6;20,6;21,6;22,6;19,7;21,7|13:9,6;7,7;8,7;9,7;10,7;11,7;7,8;9,8;10,8|21:9,1;8,2;9,2;10,2;11,2;7,3;8,3;9,3;10,3|24:5,2;4,3;5,3;4,4;5,4;6,4;7,4;5,5;6,5|26:19,2;20,2;19,3;20,3;21,3;22,3;20,4;21,4;22,4|40:1,4;1,3;1,2;0,1;1,1;2,1;3,1;1,0;2,0|43:3,8;2,7;3,7;4,7;5,7;6,7;3,6;4,6;4,5|49:11,3;12,3;9,4;10,4;11,4;12,4;13,4;11,5;12,5|97:8,4;7,5;8,5;9,5;10,5;5,6;6,6;7,6;8,6',
  '1:4,5;5,5;2,6;3,6;4,6;5,6;6,6;4,7;5,7|2:5,10;6,10;4,11;5,11;6,11;7,11;4,12;5,12;6,12|3:8,9;9,9;7,10;8,10;9,10;10,10;8,11;9,11;8,12|4:2,12;0,13;1,13;2,13;3,13;4,13;1,14;2,14;3,14|6:3,2;1,3;2,3;3,3;4,3;5,3;3,4;4,4;3,5|8:9,0;11,1;10,1;9,1;8,1;7,1;6,1;9,2;8,2|9:10,2;8,3;9,3;10,3;11,3;12,3;13,3;10,4;12,4|13:7,12;5,13;6,13;7,13;8,13;9,13;5,14;7,14;8,14|21:3,8;2,9;3,9;4,9;5,9;1,10;2,10;3,10;4,10|24:1,5;0,6;1,6;0,7;1,7;2,7;3,7;1,8;2,8|26:7,5;8,5;7,6;8,6;9,6;10,6;8,7;9,7;10,7|40:11,14;11,13;11,12;10,11;11,11;12,11;13,11;11,10;12,10|43:6,5;5,4;6,4;7,4;8,4;9,4;10,4;6,3;7,3;7,2|49:6,7;7,7;4,8;5,8;6,8;7,8;8,8;6,9;7,9|97:12,6;11,7;12,7;13,7;14,7;9,8;10,8;11,8;12,8',
  '1:3,0;4,0;1,1;2,1;3,1;4,1;5,1;3,2;4,2|2:1,2;2,2;0,3;1,3;2,3;3,3;0,4;1,4;2,4|3:4,3;5,3;3,4;4,4;5,4;6,4;4,5;5,5;4,6|4:7,1;5,2;6,2;7,2;8,2;9,2;6,3;7,3;8,3|6:12,7;10,8;11,8;12,8;13,8;14,8;12,9;13,9;12,10|8:11,10;13,11;12,11;11,11;10,11;9,11;8,11;11,12;10,12|9:4,10;2,11;3,11;4,11;5,11;6,11;7,11;4,12;6,12|13:13,5;11,6;12,6;13,6;14,6;15,6;11,7;13,7;14,7|21:9,8;8,9;9,9;10,9;11,9;7,10;8,10;9,10;10,10|24:5,7;4,8;5,8;4,9;5,9;6,9;7,9;5,10;6,10|26:0,8;1,8;0,9;1,9;2,9;3,9;1,10;2,10;3,10|40:10,4;10,3;10,2;9,1;10,1;11,1;12,1;10,0;11,0|43:6,7;5,6;6,6;7,6;8,6;9,6;6,5;7,5;7,4|49:2,6;3,6;0,7;1,7;2,7;3,7;4,7;2,8;3,8|97:14,0;13,1;14,1;15,1;16,1;11,2;12,2;13,2;14,2',
  '1:6,6;7,6;4,7;5,7;6,7;7,7;8,7;6,8;7,8|2:7,11;8,11;6,12;7,12;8,12;9,12;6,13;7,13;8,13|3:10,10;11,10;9,11;10,11;11,11;12,11;10,12;11,12;10,13|4:2,11;0,12;1,12;2,12;3,12;4,12;1,13;2,13;3,13|6:11,2;9,3;10,3;11,3;12,3;13,3;11,4;12,4;11,5|8:9,13;11,14;10,14;9,14;8,14;7,14;6,14;9,15;8,15|9:10,0;8,1;9,1;10,1;11,1;12,1;13,1;10,2;12,2|13:3,7;1,8;2,8;3,8;4,8;5,8;1,9;3,9;4,9|21:5,9;4,10;5,10;6,10;7,10;3,11;4,11;5,11;6,11|24:1,4;0,5;1,5;0,6;1,6;2,6;3,6;1,7;2,7|26:10,7;11,7;10,8;11,8;12,8;13,8;11,9;12,9;13,9|40:5,6;5,5;5,4;4,3;5,3;6,3;7,3;5,2;6,2|43:9,7;8,6;9,6;10,6;11,6;12,6;9,5;10,5;10,4|49:8,8;9,8;6,9;7,9;8,9;9,9;10,9;8,10;9,10|97:4,0;3,1;4,1;5,1;6,1;1,2;2,2;3,2;4,2',
  '1:14,2;15,2;12,3;13,3;14,3;15,3;16,3;14,4;15,4|2:6,3;7,3;5,4;6,4;7,4;8,4;5,5;6,5;7,5|3:9,2;10,2;8,3;9,3;10,3;11,3;9,4;10,4;9,5|4:17,0;15,1;16,1;17,1;18,1;19,1;16,2;17,2;18,2|6:20,5;18,6;19,6;20,6;21,6;22,6;20,7;21,7;20,8|8:3,7;5,8;4,8;3,8;2,8;1,8;0,8;3,9;2,9|9:14,7;12,8;13,8;14,8;15,8;16,8;17,8;14,9;16,9|13:4,1;2,2;3,2;4,2;5,2;6,2;2,3;4,3;5,3|21:8,5;7,6;8,6;9,6;10,6;6,7;7,7;8,7;9,7|24:4,4;3,5;4,5;3,6;4,6;5,6;6,6;4,7;5,7|26:10,0;11,0;10,1;11,1;12,1;13,1;11,2;12,2;13,2|40:1,4;1,3;1,2;0,1;1,1;2,1;3,1;1,0;2,0|43:16,6;15,5;16,5;17,5;18,5;19,5;16,4;17,4;17,3|49:7,0;8,0;5,1;6,1;7,1;8,1;9,1;7,2;8,2|97:11,6;10,7;11,7;12,7;13,7;8,8;9,8;10,8;11,8',
  '1:4,3;5,3;2,4;3,4;4,4;5,4;6,4;4,5;5,5|2:6,10;7,10;5,11;6,11;7,11;8,11;5,12;6,12;7,12|3:5,7;6,7;4,8;5,8;6,8;7,8;5,9;6,9;5,10|4:3,5;1,6;2,6;3,6;4,6;5,6;2,7;3,7;4,7|6:12,9;10,10;11,10;12,10;13,10;14,10;12,11;13,11;12,12|8:12,0;14,1;13,1;12,1;11,1;10,1;9,1;12,2;11,2|9:13,2;11,3;12,3;13,3;14,3;15,3;16,3;13,4;15,4|13:12,5;10,6;11,6;12,6;13,6;14,6;10,7;12,7;13,7|21:10,3;9,4;10,4;11,4;12,4;8,5;9,5;10,5;11,5|24:7,4;6,5;7,5;6,6;7,6;8,6;9,6;7,7;8,7|26:0,10;1,10;0,11;1,11;2,11;3,11;1,12;2,12;3,12|40:15,12;15,11;15,10;14,9;15,9;16,9;17,9;15,8;16,8|43:8,10;7,9;8,9;9,9;10,9;11,9;8,8;9,8;9,7|49:2,8;3,8;0,9;1,9;2,9;3,9;4,9;2,10;3,10|97:3,1;2,2;3,2;4,2;5,2;0,3;1,3;2,3;3,3',
  '1:18,5;19,5;16,6;17,6;18,6;19,6;20,6;18,7;19,7|2:10,6;11,6;9,7;10,7;11,7;12,7;9,8;10,8;11,8|3:13,5;14,5;12,6;13,6;14,6;15,6;13,7;14,7;13,8|4:21,3;19,4;20,4;21,4;22,4;23,4;20,5;21,5;22,5|6:2,3;0,4;1,4;2,4;3,4;4,4;2,5;3,5;2,6|8:8,8;10,9;9,9;8,9;7,9;6,9;5,9;8,10;7,10|9:18,8;16,9;17,9;18,9;19,9;20,9;21,9;18,10;20,10|13:2,8;0,9;1,9;2,9;3,9;4,9;0,10;2,10;3,10|21:21,6;20,7;21,7;22,7;23,7;19,8;20,8;21,8;22,8|24:8,3;7,4;8,4;7,5;8,5;9,5;10,5;8,6;9,6|26:14,3;15,3;14,4;15,4;16,4;17,4;15,5;16,5;17,5|40:18,4;18,3;18,2;17,1;18,1;19,1;20,1;18,0;19,0|43:4,7;3,6;4,6;5,6;6,6;7,6;4,5;5,5;5,4|49:11,3;12,3;9,4;10,4;11,4;12,4;13,4;11,5;12,5|97:12,8;11,9;12,9;13,9;14,9;9,10;10,10;11,10;12,10'
];

function key(x, y) { return `${x},${y}`; }
function normalize(cells) {
  const minX = Math.min(...cells.map(c => c.x));
  const minY = Math.min(...cells.map(c => c.y));
  return cells.map(c => ({ x: c.x - minX, y: c.y - minY })).sort((a, b) => a.y - b.y || a.x - b.x);
}
function shapeSize(cells) { return { width: Math.max(...cells.map(c => c.x)) + 1, height: Math.max(...cells.map(c => c.y)) + 1 }; }
function flip(cells, axis) {
  const size = shapeSize(cells);
  return normalize(cells.map(c => axis === 'h' ? { x: size.width - 1 - c.x, y: c.y } : { x: c.x, y: size.height - 1 - c.y }));
}
function flipBoth(cells) {
  const size = shapeSize(cells);
  return normalize(cells.map(c => ({ x: size.width - 1 - c.x, y: size.height - 1 - c.y })));
}
function rotate(cells, turns) {
  let result = cells.map(cell => ({ ...cell }));
  for (let index = 0; index < turns; index++) { const size = shapeSize(result); result = normalize(result.map(c => ({ x: size.height - 1 - c.y, y: c.x }))); }
  return result;
}
function transformCells(cells, transform = 'fixed') {
  if (transform === 'flip-x') return flip(cells, 'h');
  if (transform === 'flip-y') return flip(cells, 'v');
  if (transform === 'flip-xy') return flipBoth(cells);
  if (transform === 'rotate-90') return rotate(cells, 1);
  if (transform === 'rotate-180') return rotate(cells, 2);
  if (transform === 'rotate-270') return rotate(cells, 3);
  return normalize(cells);
}
function adjacent(p) { return [{ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }]; }
function adjacent8(p) { const result = []; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) result.push({ x: p.x + dx, y: p.y + dy }); return result; }
function cellsConnected(cells) {
  if (!cells.length) return false;
  const set = new Set(cells.map(c => key(c.x, c.y))), queue = [cells[0]], seen = new Set([key(cells[0].x, cells[0].y)]);
  while (queue.length) for (const next of adjacent(queue.shift())) if (set.has(key(next.x, next.y)) && !seen.has(key(next.x, next.y))) { seen.add(key(next.x, next.y)); queue.push(next); }
  return seen.size === cells.length;
}
function occupiedMap(placements) {
  const map = new Map();
  (placements || []).forEach(p => p.cells.forEach(c => map.set(key(c.x, c.y), p.id)));
  return map;
}
function centroidSeedInfo(placements) {
  const centroidId = activeCentroidId(), centroidPlacement = placements.find(p => p.id === centroidId), centroid = centroidPlacement?.cells || [], minX = centroid.length ? Math.min(...centroid.map(c => c.x)) : 0, minY = centroid.length ? Math.min(...centroid.map(c => c.y)) : 0, touching = new Map();
  const centroidKeys = new Set(centroid.map(cell => key(cell.x, cell.y)));
  for (const placement of placements) {
    if (placement.id === centroidId) continue;
    const contacts = [];
    for (const cell of placement.cells) for (const center of adjacent(cell)) if (centroidKeys.has(key(center.x, center.y))) contacts.push(`${center.x - minX},${center.y - minY}>${cell.x - center.x},${cell.y - center.y}`);
    if (contacts.length) touching.set(placement.id, [...new Set(contacts)].sort());
  }
  const ids = [...touching.keys()].sort((a, b) => a - b);
  const seed = ids.map(id => `#${String(id).padStart(2, '0')}[${touching.get(id).join(';')}]`).join('|') || 'none';
  return { family: ids.length ? ids.map(id => `#${String(id).padStart(2, '0')}`).join(' + ') : 'none', seed, id: seedFamilyId(seed), neighborCount: ids.length };
}
function seedFamilyId(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) { hash ^= seed.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `F-${(hash >>> 0).toString(36).toUpperCase().padStart(7, '0')}`;
}
function fieldShapeMetrics(placements, map, outside, minX, maxX, minY, maxY, centroidId = activeCentroidId()) {
  let inletCells = 0, inletEdges = 0;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const cellKey = key(x, y);
    if (map.has(cellKey) || outside.has(cellKey)) continue;
    const landNeighbors = adjacent({ x, y }).filter(next => map.has(key(next.x, next.y))).length;
    if (landNeighbors >= 2) { inletCells++; inletEdges += landNeighbors; }
  }
  const ids = [...new Set((placements || []).map(placement => placement.id))], graph = new Map(ids.map(id => [id, new Set()]));
  for (const placement of placements || []) for (const cell of placement.cells) for (const next of adjacent(cell)) { const neighborId = map.get(key(next.x, next.y)); if (neighborId != null && neighborId !== placement.id) { graph.get(placement.id)?.add(neighborId); graph.get(neighborId)?.add(placement.id); } }
  const distances = new Map([[centroidId, 0]]), queue = [centroidId];
  while (queue.length) { const current = queue.shift(), distance = distances.get(current) || 0; for (const next of graph.get(current) || []) if (!distances.has(next)) { distances.set(next, distance + 1); queue.push(next); } }
  const leafDistances = ids.filter(id => id !== centroidId && (graph.get(id)?.size || 0) === 1 && distances.has(id)).map(id => distances.get(id));
  const peninsulaDepth = leafDistances.length ? Math.max(...leafDistances) : 0;
  const nestedPeninsulaDepth = Math.max(0, peninsulaDepth - 1), terminalChains = leafDistances.filter(distance => distance >= 2).length;
  const inletRisk = inletCells + inletEdges * .25 + nestedPeninsulaDepth * 2 + terminalChains * 2;
  return { inletCells, inletEdges, peninsulaDepth, nestedPeninsulaDepth, terminalChains, inletRisk };
}
function fieldMetrics(placements) {
  const map = occupiedMap(placements), cells = [...map.keys()].map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; });
  if (!cells.length) return null;
  const minX = Math.min(...cells.map(c => c.x)), maxX = Math.max(...cells.map(c => c.x));
  const minY = Math.min(...cells.map(c => c.y)), maxY = Math.max(...cells.map(c => c.y));
  const outside = new Set([key(minX - 1, minY - 1)]), queue = [{ x: minX - 1, y: minY - 1 }];
  while (queue.length) for (const next of adjacent(queue.shift())) {
    const k = key(next.x, next.y);
    if (outside.has(k) || map.has(k) || next.x < minX - 1 || next.x > maxX + 1 || next.y < minY - 1 || next.y > maxY + 1) continue;
    outside.add(k); queue.push(next);
  }
  let holes = 0;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (!map.has(key(x, y)) && !outside.has(key(x, y))) holes++;
  const centroid = cells.filter(c => map.get(key(c.x, c.y)) === activeCentroidId());
  const fieldCenter = { x: cells.reduce((sum, c) => sum + c.x + .5, 0) / cells.length, y: cells.reduce((sum, c) => sum + c.y + .5, 0) / cells.length };
  const centerSquare = [...cells].sort((a, b) => Math.hypot((a.x + .5) - fieldCenter.x, (a.y + .5) - fieldCenter.y) - Math.hypot((b.x + .5) - fieldCenter.x, (b.y + .5) - fieldCenter.y) || a.y - b.y || a.x - b.x)[0];
  const centerSquareDistance = Math.hypot((centerSquare.x + .5) - fieldCenter.x, (centerSquare.y + .5) - fieldCenter.y);
  const centroidPoint = centroid.length ? { x: centroid.reduce((sum, c) => sum + c.x + .5, 0) / centroid.length, y: centroid.reduce((sum, c) => sum + c.y + .5, 0) / centroid.length } : null;
  const centroidSquareOffset = centroidPoint ? Math.hypot(centroidPoint.x - (centerSquare.x + .5), centroidPoint.y - (centerSquare.y + .5)) : Infinity;
  const cellDistances = centroidPoint ? cells.map(c => Math.hypot(c.x + .5 - centroidPoint.x, c.y + .5 - centroidPoint.y)) : [];
  const cellMeanRadius = cellDistances.length ? cellDistances.reduce((sum, value) => sum + value, 0) / cellDistances.length : 0;
  const gravityVariance = cellDistances.length ? Math.sqrt(cellDistances.reduce((sum, value) => sum + (value - cellMeanRadius) ** 2, 0) / cellDistances.length) : Infinity;
  const gravityOffset = centroidPoint ? Math.hypot(cells.reduce((sum, c) => sum + c.x + .5 - centroidPoint.x, 0), cells.reduce((sum, c) => sum + c.y + .5 - centroidPoint.y, 0)) / cells.length : Infinity;
  const gravityTension = gravityVariance + gravityOffset * 2;
  const boundary = [];
  let perimeter = 0;
  for (const cell of cells) for (const next of adjacent(cell)) if (!map.has(key(next.x, next.y))) {
    perimeter++;
    boundary.push({ x: cell.x + (next.x - cell.x) * .5 + .5, y: cell.y + (next.y - cell.y) * .5 + .5 });
  }
  const coastDistances = centroidPoint ? boundary.map(c => Math.hypot(c.x - centroidPoint.x, c.y - centroidPoint.y)) : [];
  const coastMean = coastDistances.length ? coastDistances.reduce((sum, value) => sum + value, 0) / coastDistances.length : 0;
  const radialVariance = coastDistances.length ? Math.sqrt(coastDistances.reduce((sum, value) => sum + (value - coastMean) ** 2, 0) / coastDistances.length) : Infinity;
  const centerOffset = centroidPoint ? Math.hypot(centroidPoint.x - fieldCenter.x, centroidPoint.y - fieldCenter.y) : Infinity;
  const width = maxX - minX + 1, height = maxY - minY + 1, density = cells.length / (width * height);
  const centroidEdgeCoast = centroid.some(c => adjacent(c).some(next => !map.has(key(next.x, next.y))));
  const centroidCornerCoast = centroid.some(c => adjacent8(c).some(next => !adjacent(c).some(edge => edge.x === next.x && edge.y === next.y) && !map.has(key(next.x, next.y))));
  const centroidCoast = centroidEdgeCoast || centroidCornerCoast;
  const enclosure = centroidEdgeCoast ? 'open' : centroidCornerCoast ? 'weak' : 'strong';
  const topology = fieldShapeMetrics(placements, map, outside, minX, maxX, minY, maxY);
  const centroidSeed = centroidSeedInfo(placements);
  const enclosurePenalty = centroidEdgeCoast ? Infinity : centroidCornerCoast ? 100000 : 0;
  // Coastline is primary. Strong enclosure outranks weak enclosure, then
  // circularity and centroid balance break remaining ties.
  const score = perimeter * 1000000 + enclosurePenalty + radialVariance * 1000 + centerOffset * 100 + centroidSquareOffset * 50 + centerSquareDistance * 10 + (1 - density) * 10;
  return { map, cells, minX, maxX, minY, maxY, width, height, holes, centroidCoast, centroidEdgeCoast, centroidCornerCoast, enclosure, centroidFamily: centroidSeed.family, centroidFamilyId: centroidSeed.id, centroidSeed: centroidSeed.seed, centroidNeighborCount: centroidSeed.neighborCount, area: cells.length, perimeter, density, fieldCenter, centerSquare, centerSquareDistance, centroidPoint, centroidSquareOffset, centerOffset, coastMean, radialVariance, gravityVariance, gravityOffset, gravityTension, score, ...topology };
}
function pieceCenter(metrics, id) {
  const cells = metrics.cells.filter(cell => metrics.map.get(key(cell.x, cell.y)) === id);
  return cells.length ? { x: cells.reduce((sum, cell) => sum + cell.x + .5, 0) / cells.length, y: cells.reduce((sum, cell) => sum + cell.y + .5, 0) / cells.length } : null;
}
function pieceDirections(metrics, id) {
  if (!metrics || id === activeCentroidId()) return [];
  const pieceCells = metrics.cells.filter(cell => metrics.map.get(key(cell.x, cell.y)) === id);
  const centroidCells = metrics.cells.filter(cell => metrics.map.get(key(cell.x, cell.y)) === activeCentroidId());
  if (!pieceCells.length || !centroidCells.length) return [];
  const bounds = cells => ({ minX: Math.min(...cells.map(cell => cell.x)), maxX: Math.max(...cells.map(cell => cell.x)), minY: Math.min(...cells.map(cell => cell.y)), maxY: Math.max(...cells.map(cell => cell.y)) });
  const center = cells => ({ x: cells.reduce((sum, cell) => sum + cell.x + .5, 0) / cells.length, y: cells.reduce((sum, cell) => sum + cell.y + .5, 0) / cells.length });
  const pieceBounds = bounds(pieceCells), centroidBounds = bounds(centroidCells), pieceCenter = center(pieceCells), centroidCenter = center(centroidCells), candidates = [];
  if (pieceBounds.minX < centroidBounds.minX) candidates.push({ direction: 'west', dominance: Math.abs(pieceCenter.x - centroidCenter.x), gap: centroidBounds.minX - pieceBounds.minX });
  if (pieceBounds.maxX > centroidBounds.maxX) candidates.push({ direction: 'east', dominance: Math.abs(pieceCenter.x - centroidCenter.x), gap: pieceBounds.maxX - centroidBounds.maxX });
  if (pieceBounds.minY < centroidBounds.minY) candidates.push({ direction: 'north', dominance: Math.abs(pieceCenter.y - centroidCenter.y), gap: centroidBounds.minY - pieceBounds.minY });
  if (pieceBounds.maxY > centroidBounds.maxY) candidates.push({ direction: 'south', dominance: Math.abs(pieceCenter.y - centroidCenter.y), gap: pieceBounds.maxY - centroidBounds.maxY });
  candidates.sort((a, b) => b.dominance - a.dominance || b.gap - a.gap);
  return candidates.length ? [candidates[0].direction] : [];
}
function configuredPreferences() {
  return [...app.positionPreferences.entries()]
    .filter(([pieceId, preference]) => Number(pieceId) !== activeCentroidId() && preference?.direction)
    .map(([pieceId, preference]) => ({ pieceId: Number(pieceId), ...preference }));
}
function configuredPreference() {
  if (app.selectedId == null || app.selectedId === activeCentroidId()) return null;
  const preference = app.positionPreferences.get(app.selectedId);
  return preference?.direction ? { pieceId: app.selectedId, ...preference } : null;
}
function activePreferences() { return app.preferenceEnabled ? configuredPreferences() : []; }
function preferenceMatchCount(snapshot, preferences = activePreferences()) {
  if (!preferences.length) return 0;
  const metrics = snapshot.metrics || fieldMetrics(snapshot.placements);
  return preferences.reduce((count, preference) => count + (pieceDirections(metrics, preference.pieceId).includes(preference.direction) ? 1 : 0), 0);
}
function savedPreferenceMatchCount(snapshot) { return preferenceMatchCount(snapshot, configuredPreferences()); }
function preferenceMatches(snapshot) {
  const preferences = activePreferences();
  return !preferences.length || preferenceMatchCount(snapshot) === preferences.length;
}
function arrangementSortMetric(snapshot) {
  const metrics = snapshot.metrics || fieldMetrics(snapshot.placements), hintMatches = savedPreferenceMatchCount(snapshot);
  if (app.arrangementSort === 'hints') return { primary: -hintMatches, secondary: metrics.score };
  if (app.arrangementSort === 'coast') return { primary: metrics.perimeter, secondary: metrics.score };
  if (app.arrangementSort === 'density') return { primary: -metrics.density, secondary: metrics.score };
  if (app.arrangementSort === 'enclosure') return { primary: ({ strong: 0, weak: 1, open: 2 }[metrics.enclosure] || 3), secondary: metrics.perimeter };
  if (app.arrangementSort === 'compact') return { primary: metrics.width * metrics.height, secondary: metrics.width + metrics.height };
  if (app.arrangementSort === 'radial') return { primary: metrics.radialVariance, secondary: metrics.perimeter };
  if (app.arrangementSort === 'central') return { primary: metrics.centerOffset, secondary: metrics.centroidSquareOffset };
  if (app.arrangementSort === 'square') return { primary: metrics.centerSquareDistance, secondary: metrics.centroidSquareOffset };
  if (app.arrangementSort === 'inlets') return { primary: metrics.inletRisk, secondary: metrics.perimeter };
  return { primary: metrics.score, secondary: metrics.perimeter };
}
function orderedSnapshots(snapshots) {
  const preferences = activePreferences();
  const sorted = [...snapshots].sort((a, b) => {
    const aMetric = arrangementSortMetric(a), bMetric = arrangementSortMetric(b);
    if (app.arrangementSort === 'best' && preferences.length && app.preferenceMode === 'rank') {
      const preferenceDelta = preferenceMatchCount(b) - preferenceMatchCount(a);
      if (preferenceDelta) return preferenceDelta;
    }
    return aMetric.primary - bMetric.primary || aMetric.secondary - bMetric.secondary;
  });
  return app.preferenceMode === 'only' && preferences.length ? sorted.filter(preferenceMatches) : sorted;
}
function arrangementPlacementMap(snapshot) {
  if (snapshot.variantMap) return snapshot.variantMap;
  const centroid = snapshot.placements?.find(placement => placement.id === activeCentroidId()), base = (centroid?.cells || snapshot.placements?.flatMap(placement => placement.cells) || [])[0] || { x: 0, y: 0 };
  const map = new Map();
  for (const placement of snapshot.placements || []) {
    if (placement.id === activeCentroidId()) continue;
    map.set(placement.id, placement.cells.map(cell => `${cell.x - base.x},${cell.y - base.y}`).sort().join(';'));
  }
  snapshot.variantMap = map;
  return map;
}
function arrangementVariantGroups(snapshots) {
  const anchor = snapshots[0], anchorMap = anchor ? arrangementPlacementMap(anchor) : new Map(), pieceIds = activePieceIds(), groups = new Map();
  for (const snapshot of snapshots) {
    const currentMap = arrangementPlacementMap(snapshot), changedIds = pieceIds.filter(id => id !== activeCentroidId() && currentMap.get(id) !== anchorMap.get(id)), difference = changedIds.length;
    if (!groups.has(difference)) groups.set(difference, { difference, changedIds, entries: [] });
    groups.get(difference).entries.push({ snapshot, changedIds });
  }
  return [...groups.values()].sort((a, b) => a.difference - b.difference);
}
function familySortMetric(snapshots) {
  const ordered = snapshots.length ? [snapshots[0]] : [];
  const metrics = ordered[0] ? snapshotMetrics(ordered[0]) : null;
  if (!metrics) return { primary: Infinity, secondary: Infinity };
  let primary, secondary;
  if (app.familySort === 'coast') { primary = metrics.perimeter; secondary = metrics.score; }
  else if (app.familySort === 'density') { primary = -metrics.density; secondary = metrics.score; }
  else if (app.familySort === 'central') { primary = metrics.centroidSquareOffset; secondary = metrics.centerOffset; }
  else if (app.familySort === 'enclosure') { primary = ({ strong: 0, weak: 1, open: 2 }[metrics.enclosure] || 3); secondary = metrics.perimeter; }
  else if (app.familySort === 'arrangements') { primary = -snapshots.length; secondary = metrics.score; }
  else { primary = metrics.score; secondary = metrics.perimeter; }
  if (activePreferences().length && app.preferenceMode === 'rank') return { primary: -preferenceMatchCount(ordered[0]), secondary: primary, tertiary: secondary };
  return { primary, secondary };
}
function preferenceSummary() {
  const preferences = configuredPreferences();
  if (!preferences.length) return 'No placement preference';
  const suffix = app.preferenceMode === 'only' ? 'matches only' : 'matches first';
  if (!app.preferenceEnabled) return `${preferences.length} hints saved · filter off`;
  return `${preferences.length} hints · ${suffix}`;
}
function applyLock(piece) { return transformCells(piece.cells, piece.orientation || 'fixed'); }
function placedCells(piece, origin) { return applyLock(piece).map(c => ({ x: origin.x + c.x, y: origin.y + c.y })); }
function savedPieceColors() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLOR_STORAGE_KEY) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch (error) {
    return {};
  }
}
function persistPieceColors() {
  try { localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify(Object.fromEntries(app.pieces.map(piece => [piece.id, piece.color])))); } catch (error) { console.warn('The piece palette could not be saved.', error); }
}
function restorePositionPreferences() {
  try {
    const saved = app.presetData ? app.presetData.positionPreferences : JSON.parse(localStorage.getItem(POSITION_PREFERENCE_STORAGE_KEY) || '{}');
    if (!saved || typeof saved !== 'object') return;
    Object.entries(saved).forEach(([pieceId, direction]) => {
      if (activePieceIds().includes(Number(pieceId)) && Number(pieceId) !== activeCentroidId() && ['north', 'west', 'east', 'south'].includes(direction)) app.positionPreferences.set(Number(pieceId), { direction });
    });
  } catch (error) {
    console.warn('The placement preferences could not be restored.', error);
  }
}
function persistPositionPreferences() {
  try { const value = Object.fromEntries([...app.positionPreferences.entries()].map(([pieceId, preference]) => [pieceId, preference.direction])); app.presetData.positionPreferences = value; persistPresetStore(); localStorage.setItem(POSITION_PREFERENCE_STORAGE_KEY, JSON.stringify(value)); } catch (error) { console.warn('The placement preferences could not be saved.', error); }
}
function restorePositionLocks() {
  try {
    const saved = app.presetData?.positionLocks || readJsonStorage(POSITION_LOCK_STORAGE_KEY, {});
    if (!saved || typeof saved !== 'object') return;
    Object.entries(saved).forEach(([pieceId, lock]) => {
      const id = Number(pieceId);
      if (activePieceIds().includes(id) && id !== activeCentroidId() && lock && Number.isFinite(Number(lock.dx)) && Number.isFinite(Number(lock.dy))) app.positionLocks.set(id, { dx: Number(lock.dx), dy: Number(lock.dy) });
    });
  } catch (error) {
    console.warn('The exact placement locks could not be restored.', error);
  }
}
function persistPositionLocks() {
  try { const value = Object.fromEntries(app.positionLocks.entries()); app.presetData.positionLocks = value; persistPresetStore(); localStorage.setItem(POSITION_LOCK_STORAGE_KEY, JSON.stringify(value)); } catch (error) { console.warn('The exact placement locks could not be saved.', error); }
}
function placementOrigin(placement) {
  if (!placement?.cells?.length) return null;
  return { x: Math.min(...placement.cells.map(cell => cell.x)), y: Math.min(...placement.cells.map(cell => cell.y)) };
}
function currentPositionLock(pieceId) {
  if (!app.placements || pieceId === activeCentroidId()) return null;
  const placement = app.placements.find(item => item.id === pieceId), centroid = app.placements.find(item => item.id === activeCentroidId()), pieceOrigin = placementOrigin(placement), centroidOrigin = placementOrigin(centroid);
  if (!pieceOrigin || !centroidOrigin) return null;
  return { dx: pieceOrigin.x - centroidOrigin.x, dy: pieceOrigin.y - centroidOrigin.y };
}
function formatPositionLock(lock) {
  if (!lock) return 'none';
  return `Δx ${lock.dx >= 0 ? '+' : ''}${lock.dx} · Δy ${lock.dy >= 0 ? '+' : ''}${lock.dy}`;
}
function restoreFamilySteering() {
  try {
    const saved = app.presetData ? app.presetData.familySteering : JSON.parse(localStorage.getItem(FAMILY_STEERING_STORAGE_KEY) || '{}');
    if (!saved || typeof saved !== 'object') return;
    Object.entries(saved).forEach(([familyId, value]) => {
      if (value && typeof value === 'object') app.familySteering.set(familyId, { enabled: Boolean(value.enabled), weight: Math.min(5, Math.max(.1, Number(value.weight) || 1)) });
    });
  } catch (error) {
    console.warn('The family steering settings could not be restored.', error);
  }
}
function persistFamilySteering() {
  try { const value = Object.fromEntries(app.familySteering.entries()); app.presetData.familySteering = value; persistPresetStore(); localStorage.setItem(FAMILY_STEERING_STORAGE_KEY, JSON.stringify(value)); } catch (error) { console.warn('The family steering settings could not be saved.', error); }
}
function restoreSearchProgress() {
  const bankedNodes = app.snapshots.reduce((sum, snapshot) => sum + (Number(snapshot.nodes) || 0), 0);
  try {
    const saved = app.presetData ? app.presetData.progress : JSON.parse(localStorage.getItem(SEARCH_PROGRESS_STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      app.totalNodes = Math.max(bankedNodes, Number(saved.totalNodes) || 0);
      app.completedPasses = Math.max(0, Number(saved.completedPasses) || 0);
      app.progressEstimate = saved.exact ? 'persisted total' : 'banked lower bound';
      app.searchCheckpoint = saved.checkpoint && typeof saved.checkpoint === 'object' ? saved.checkpoint : null;
    } else {
      app.totalNodes = bankedNodes;
      app.completedPasses = 0;
      app.progressEstimate = 'banked lower bound';
      persistSearchProgress();
    }
  } catch (error) {
    app.totalNodes = bankedNodes;
    app.progressEstimate = 'banked lower bound';
    console.warn('The search progress could not be restored.', error);
  }
  app.nodes = app.totalNodes;
  app.lastPersistedNodes = app.totalNodes;
}
function persistSearchProgress(exact = false) {
  try { const value = { totalNodes: app.totalNodes, completedPasses: app.completedPasses, checkpoint: app.searchCheckpoint || null, exact, updatedAt: Date.now() }; app.presetData.progress = value; persistPresetStore(); localStorage.setItem(SEARCH_PROGRESS_STORAGE_KEY, JSON.stringify(value)); app.lastPersistedNodes = app.totalNodes; } catch (error) { console.warn('The search progress could not be saved.', error); }
}
function familySteeringEntries(orderedFamilies = []) {
  const known = new Set(orderedFamilies.map(([family]) => family));
  return [...app.familySteering.entries()].filter(([familyId, setting]) => known.has(familyId) && setting.enabled).map(([familyId, setting]) => ({ familyId, weight: Math.min(5, Math.max(.1, Number(setting.weight) || 1)), threads: Math.max(1, Math.round(Math.min(5, Math.max(.1, Number(setting.weight) || 1)))) }));
}
function nextFamilySteeringTarget(orderedFamilies) {
  const entries = familySteeringEntries(orderedFamilies), schedule = [];
  entries.forEach(entry => { for (let index = 0; index < entry.threads; index++) schedule.push({ familyId: entry.familyId, threadIndex: index }); });
  if (!schedule.length) return null;
  const scheduleIndex = app.familySteeringPass % schedule.length, round = Math.floor(app.familySteeringPass / schedule.length), slot = schedule[scheduleIndex]; app.familySteeringPass += 1;
  const familyId = slot.familyId;
  const snapshot = app.snapshots.find(item => snapshotMetrics(item).centroidFamilyId === familyId);
  return snapshot ? { familyId, seed: snapshotMetrics(snapshot).centroidSeed, threadIndex: slot.threadIndex, round, searchSalt: `${familyId}:thread-${slot.threadIndex}:round-${round}` } : null;
}
function defaultPieceColor(id) { return COLORS[activePieceIds().indexOf(id)] || '#9aafcc'; }
function createPieces() {
  const savedColors = savedPieceColors();
  return (app.preset?.pieces || PIECE_IDS.map(id => ({ permutation: id, transform: LOCKS[id] || 'fixed' }))).map((definition, index) => {
    const id = Number(definition.permutation);
    let cells = normalize(SOURCE_SHAPES[id].map(([x, y]) => ({ x, y })));
    // The source representative is stored exactly as emitted. The visible
    // orientation is normalized for the inspector; locked transforms are
    // applied only when generating a placement.
    return { id, color: /^#[0-9a-f]{6}$/i.test(savedColors[id]) ? savedColors[id] : COLORS[index], cells, orientation: definition.transform || 'fixed' };
  });
}

function clearPieceSelection() {
  app.selectedId = null; app.selectedFamily = null; app.arrangementPinned = false; app.sidebarMode = 'pieces'; renderSidebarMode(); renderPieceList(); renderInspector(); highlightPiece();
}
function renderPieceList() {
  const root = document.querySelector('#pieceList'); root.innerHTML = '';
  app.pieces.forEach(piece => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `piece-item ${app.selectedId === piece.id ? 'selected' : ''} ${piece.id === activeCentroidId() ? 'centroid-piece' : ''} ${app.positionLocks.has(piece.id) ? 'position-locked' : ''}`; button.style.setProperty('--piece-color', piece.color); button.dataset.id = piece.id; button.setAttribute('aria-pressed', String(app.selectedId === piece.id)); button.setAttribute('aria-label', `Permutation #${String(piece.id).padStart(2, '0')}${app.selectedId === piece.id ? ', selected; click again to deselect' : ''}${app.positionLocks.has(piece.id) ? ', exact position locked' : ''}`);
    const swatch = document.createElement('span'); swatch.className = 'piece-swatch'; const shape = applyLock(piece); const size = shapeSize(shape); const cellSize = Math.min(5, 23 / Math.max(size.width, size.height)); swatch.style.gridTemplateColumns = `repeat(${size.width}, ${cellSize}px)`; swatch.style.gridTemplateRows = `repeat(${size.height}, ${cellSize}px)`; swatch.style.width = `${size.width * cellSize + Math.max(0, size.width - 1)}px`; swatch.style.height = `${size.height * cellSize + Math.max(0, size.height - 1)}px`;
    for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) { const cell = document.createElement('i'); if (!shape.some(c => c.x === x && c.y === y)) cell.style.visibility = 'hidden'; swatch.appendChild(cell); }
    button.innerHTML = `<span class="piece-number">#${String(piece.id).padStart(2, '0')}</span>`; button.appendChild(swatch); button.insertAdjacentHTML('beforeend', `<span class="piece-tag ${piece.orientation !== 'fixed' ? 'flip' : ''} ${piece.id === activeCentroidId() ? 'centroid-tag' : ''} ${app.positionLocks.has(piece.id) ? 'locked-tag' : ''}">${piece.id === activeCentroidId() ? 'centroid' : orientationLabel(piece.orientation)}${app.positionLocks.has(piece.id) ? ' · lock' : ''}</span>`);
    button.addEventListener('click', () => { if (app.selectedId === piece.id) clearPieceSelection(); else { app.selectedId = piece.id; app.selectedFamily = null; app.arrangementPinned = false; app.sidebarMode = 'pieces'; renderSidebarMode(); renderPieceList(); renderInspector(); highlightPiece(); } }); root.appendChild(button);
  });
}
function renderBoard() {
  const board = document.querySelector('#board'); board.innerHTML = '';
  if (!app.placements) { board.className = 'board board-empty'; board.style.gridTemplateColumns = ''; board.style.gridTemplateRows = ''; board.style.width = ''; board.style.height = ''; board.innerHTML = '<div><span class="empty-glyph">✦</span><strong>Search for a field</strong><small>15 fixed-orientation nonominoes / 135 squares</small></div>'; updateMetrics(null); return; }
  const metrics = fieldMetrics(app.placements); board.className = 'board'; board.style.gridTemplateColumns = `repeat(${metrics.width}, minmax(0, 1fr))`; board.style.gridTemplateRows = `repeat(${metrics.height}, minmax(0, 1fr))`; board.style.aspectRatio = `${metrics.width} / ${metrics.height}`;
  for (let y = metrics.minY; y <= metrics.maxY; y++) for (let x = metrics.minX; x <= metrics.maxX; x++) {
    const id = metrics.map.get(key(x, y)), piece = app.pieces.find(p => p.id === id), cell = document.createElement('div'); cell.className = `cell ${key(x, y) === key(metrics.centerSquare.x, metrics.centerSquare.y) ? 'center-square' : ''}`; cell.style.setProperty('--piece-color', piece?.color || 'transparent'); cell.dataset.id = id || '';
    cell.addEventListener('click', () => { if (!id || app.selectedId === id) clearPieceSelection(); else { app.selectedId = id; app.selectedFamily = null; app.arrangementPinned = false; app.sidebarMode = 'pieces'; renderSidebarMode(); renderPieceList(); renderInspector(); highlightPiece(); } }); board.appendChild(cell);
  }
  updateMetrics(metrics); requestAnimationFrame(fitBoardToViewport);
}
function fitBoardToViewport() {
  if (!app.placements) return;
  const frame = document.querySelector('.board-frame'), board = document.querySelector('#board');
  if (!frame || !board) return;
  const metrics = fieldMetrics(app.placements), availableWidth = Math.max(1, frame.clientWidth - 2), availableHeight = Math.max(1, frame.clientHeight - 2);
  const scale = Math.min(availableWidth / metrics.width, availableHeight / metrics.height);
  board.style.width = `${Math.max(1, Math.floor(metrics.width * scale))}px`;
  board.style.height = `${Math.max(1, Math.floor(metrics.height * scale))}px`;
}
function updateMetrics(metrics) {
  document.querySelector('#fieldSize').textContent = metrics ? `${metrics.width} × ${metrics.height}` : '—';
  document.querySelector('#coverageStat').innerHTML = metrics ? '100<span>%</span>' : '—'; document.querySelector('#coverageDetail').textContent = metrics ? `${metrics.area} / 135 squares` : '135 squares total';
  document.querySelector('#holesStat').textContent = metrics ? String(metrics.holes).padStart(2, '0') : '—'; document.querySelector('#holesDetail').textContent = metrics ? (metrics.holes === 0 ? '✓ clean field' : 'not verified') : 'awaiting a verified field';
  document.querySelector('#centroidDetail').textContent = metrics ? (metrics.centroidEdgeCoast ? 'coastal — rejected' : `${metrics.enclosure} enclosure · Δ ${metrics.centerOffset.toFixed(1)} · cΔ ${metrics.centroidSquareOffset.toFixed(1)}`) : 'marked in piece list';
  document.querySelector('#coastStat').textContent = metrics ? String(metrics.perimeter) : '—'; document.querySelector('#coastDetail').textContent = metrics ? `σ ${metrics.radialVariance.toFixed(1)} · lower wins` : 'lower is better';
  updateSearchTelemetry();
}
function highlightPiece() { document.querySelectorAll('.cell').forEach(cell => { cell.style.filter = app.selectedId == null || !cell.dataset.id || Number(cell.dataset.id) === app.selectedId ? '' : 'saturate(.25) opacity(.45)'; }); }
function renderPlacementPreference(piece) {
  const root = document.querySelector('#placementPreference');
  if (!root) return;
  root.innerHTML = '';
  if (!piece || piece.id === activeCentroidId()) {
    root.hidden = true;
    return;
  }
  const preference = app.positionPreferences.get(piece.id) || { direction: null };
  const currentDirection = app.placements ? pieceDirections(fieldMetrics(app.placements), piece.id)[0] : null;
  const savedLock = app.positionLocks.get(piece.id) || null, currentLock = currentPositionLock(piece.id);
  root.hidden = false;
  root.innerHTML = `<div class="preference-heading"><span>Placement preference</span><small>relative to #${String(activeCentroidId()).padStart(2, '0')}</small></div><div class="direction-picker" role="group" aria-label="Preferred cardinal direction"><button type="button" class="direction-button ${preference.direction === 'north' ? 'selected' : ''}" data-direction="north" aria-pressed="${preference.direction === 'north'}">N</button><button type="button" class="direction-button ${preference.direction === 'west' ? 'selected' : ''}" data-direction="west" aria-pressed="${preference.direction === 'west'}">W</button><button type="button" class="direction-button clear-direction ${!preference.direction ? 'selected' : ''}" data-direction="" aria-pressed="${!preference.direction}">·</button><button type="button" class="direction-button ${preference.direction === 'east' ? 'selected' : ''}" data-direction="east" aria-pressed="${preference.direction === 'east'}">E</button><button type="button" class="direction-button ${preference.direction === 'south' ? 'selected' : ''}" data-direction="south" aria-pressed="${preference.direction === 'south'}">S</button></div><p class="preference-state">Saved: ${preference.direction || 'none'} · Current field: ${currentDirection || 'not placed'}</p><p class="preference-help">A piece must lie beyond one centroid edge; diagonal cases use the dominant axis. The saved hint can reorder or filter banked arrangements.</p><div class="position-lock"><div class="preference-heading"><span>Exact position lock</span><small>origin offset</small></div><p class="preference-state">Saved: ${formatPositionLock(savedLock)} · Current: ${formatPositionLock(currentLock)}</p><div class="position-lock-actions"><button type="button" class="lock-position-button" data-lock-action="save" ${currentLock ? '' : 'disabled'}>${savedLock ? 'Update from current' : 'Lock current offset'}</button><button type="button" class="lock-position-button clear-lock" data-lock-action="clear" ${savedLock ? '' : 'disabled'}>Clear</button></div><p class="preference-help">A hard constraint on this piece's origin relative to the centroid. It applies on the next search pass.</p></div>`;
  root.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => {
    const direction = button.dataset.direction || null;
    if (direction) app.positionPreferences.set(piece.id, { direction }); else app.positionPreferences.delete(piece.id);
    persistPositionPreferences();
    renderInspector();
    renderSnapshots();
  }));
  root.querySelector('[data-lock-action="save"]')?.addEventListener('click', () => {
    const lock = currentPositionLock(piece.id);
    if (!lock) return;
    app.positionLocks.set(piece.id, lock);
    persistPositionLocks();
    renderPieceList();
    renderInspector();
    toast(`#${String(piece.id).padStart(2, '0')} locked at ${formatPositionLock(lock)}`);
  });
  root.querySelector('[data-lock-action="clear"]')?.addEventListener('click', () => {
    app.positionLocks.delete(piece.id);
    persistPositionLocks();
    renderPieceList();
    renderInspector();
    toast(`#${String(piece.id).padStart(2, '0')} position lock cleared`);
  });
}
function refreshColorDependentViews() {
  persistPieceColors();
  renderPieceList();
  renderBoard();
  renderSnapshots();
  highlightPiece();
}
function renderColorSettings(piece) {
  const root = document.querySelector('#pieceColorSettings');
  if (!root) return;
  root.innerHTML = '';
  if (!piece) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  root.innerHTML = `<div class="color-settings-heading"><span>Rendered color</span><small>#${String(piece.id).padStart(2, '0')}</small></div><div class="color-settings-controls"><label class="color-wheel-label" for="pieceColorInput"><span class="color-wheel" aria-hidden="true"></span><span>Open color wheel</span></label><input id="pieceColorInput" type="color" value="${piece.color}" aria-label="Rendered color for permutation #${String(piece.id).padStart(2, '0')}" /><button id="resetPieceColor" class="reset-color-button" type="button">Default</button></div><p class="color-settings-help">Changes the display palette only; shape identity and saved solutions stay unchanged.</p>`;
  const input = root.querySelector('#pieceColorInput'), swatch = root.querySelector('.color-wheel'), reset = root.querySelector('#resetPieceColor');
  const updateColor = () => {
    piece.color = input.value;
    swatch.style.background = piece.color;
    refreshColorDependentViews();
  };
  input.addEventListener('input', updateColor);
  input.addEventListener('change', updateColor);
  reset.addEventListener('click', () => {
    piece.color = defaultPieceColor(piece.id);
    input.value = piece.color;
    swatch.style.background = piece.color;
    refreshColorDependentViews();
  });
  swatch.style.background = piece.color;
}
function renderInspector() {
  const piece = app.pieces.find(p => p.id === app.selectedId), title = document.querySelector('#inspectorTitle'), chip = document.querySelector('.selected-chip'), text = document.querySelector('#inspectorText'), motion = document.querySelector('#inspectorMotion'), preview = document.querySelector('#inspectorPreview'), detailValues = document.querySelectorAll('.detail-list strong');
  if (!piece) { title.textContent = 'No piece selected'; chip.textContent = 'NONE'; chip.classList.add('empty-chip'); text.textContent = 'Click a nonomino in the map or sidebar to inspect it. Click that same piece again, or any empty map cell, to clear the selection.'; motion.textContent = '—'; detailValues[0].textContent = '—'; detailValues[1].textContent = '—'; preview.innerHTML = '<span class="empty-inspector">No selection</span>'; renderColorSettings(null); renderPlacementPreference(null); return; }
  chip.textContent = 'SELECTED'; chip.classList.remove('empty-chip'); title.textContent = `#${String(piece.id).padStart(2, '0')} / ${piece.id === activeCentroidId() ? 'centroid' : 'permutation'}`; motion.textContent = orientationLabel(piece.orientation); detailValues[0].textContent = '09 squares'; detailValues[1].textContent = 'TDOTDH catalog'; text.textContent = piece.id === activeCentroidId() ? `The source representative for permutation #${piece.id} is the protected centroid. The search may translate it, but never rotates it.` : piece.id === 43 ? 'Permutation #43 is X-flipped by reversing its minimum and maximum X coordinates.' : piece.id === 40 ? 'Permutation #40 is flipped on both X and Y, equivalent to a 180° rotation.' : `Permutation #${piece.id} is a unique source representative from the 9-area TDOTDH catalog.`;
  const shape = applyLock(piece), size = shapeSize(shape); preview.innerHTML = ''; const diagram = document.createElement('div'); diagram.className = 'mini-shape'; diagram.style.setProperty('--shape-width', size.width); diagram.style.setProperty('--shape-height', size.height); diagram.style.setProperty('--piece-color', piece.color); for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) { const cell = document.createElement('span'); cell.className = shape.some(c => c.x === x && c.y === y) ? 'mini-cell' : 'mini-cell empty'; diagram.appendChild(cell); } preview.appendChild(diagram); renderColorSettings(piece); renderPlacementPreference(piece);
}
function snapshotSignature(placements) {
  const cells = placements.flatMap(p => p.cells);
  const minX = Math.min(...cells.map(c => c.x)), minY = Math.min(...cells.map(c => c.y));
  return [...placements].sort((a, b) => a.id - b.id).map(p => `${p.id}:${p.cells.map(c => `${c.x - minX},${c.y - minY}`).sort().join(';')}`).join('|');
}
function snapshotMetrics(snapshot) {
  if (!snapshot.metrics) snapshot.metrics = fieldMetrics(snapshot.placements);
  return snapshot.metrics;
}
function snapshotFamilyInfo(snapshot) {
  if (!snapshot.familyInfo) snapshot.familyInfo = centroidSeedInfo(snapshot.placements);
  return snapshot.familyInfo;
}
function snapshotFamilyId(snapshot) {
  const info = snapshotFamilyInfo(snapshot);
  return info.id || seedFamilyId(info.seed);
}
function persistSnapshots() {
  try {
    // Store one normalized signature per arrangement. Keeping the full cell
    // objects here and again inside the active preset needlessly doubles the
    // localStorage footprint once the overnight bank reaches hundreds.
    const value = app.snapshots.map(snapshot => ({ signature: snapshot.signature || snapshotSignature(snapshot.placements), nodes: snapshot.nodes || 0 }));
    app.presetData.snapshots = value;
    // The preset bank is now the canonical snapshot store. Older builds also
    // wrote this same index to SNAPSHOT_STORAGE_KEY, doubling the storage and
    // parse cost on every reload. Remove that redundant copy only after the
    // canonical write succeeds.
    if (persistPresetStore()) localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
  } catch (error) {
    console.warn('The bestiary could not be saved locally.', error);
  }
}
function decodeRecoveredSnapshot(encoded) {
  return encoded.split('|').map(entry => {
    const [idText, cellsText] = entry.split(':');
    return { id: Number(idText), origin: { x: 0, y: 0 }, cells: cellsText.split(';').map(cell => { const [x, y] = cell.split(',').map(Number); return { x, y }; }) };
  });
}
function restoreSnapshots() {
  try {
    const storedValue = app.presetData ? app.presetData.snapshots : JSON.parse(localStorage.getItem(SNAPSHOT_STORAGE_KEY) || '[]');
    const hasStoredBank = Array.isArray(storedValue) && storedValue.length > 0;
    const needsCompaction = hasStoredBank && storedValue.some(snapshot => !snapshot || typeof snapshot.signature !== 'string' || Array.isArray(snapshot.placements));
    const hasLegacyCopy = Boolean(localStorage.getItem(SNAPSHOT_STORAGE_KEY));
    // The catalog/orientation correction invalidates earlier banks, so only
    // the current versioned bank is trusted from this point onward.
    const stored = hasStoredBank ? storedValue : [];
    app.snapshots = stored.map(snapshot => {
      const placements = Array.isArray(snapshot.placements) ? snapshot.placements : typeof snapshot.signature === 'string' ? decodeRecoveredSnapshot(snapshot.signature) : null;
      if (!placements) return null;
      const area = placements.reduce((sum, placement) => sum + (placement.cells?.length || 0), 0);
      if (placements.length !== activePieceIds().length || area !== activePieceIds().length * AREA) return null;
      return { placements, signature: snapshot.signature || snapshotSignature(placements), metrics: null, familyInfo: null, nodes: Number(snapshot.nodes) || 0 };
    }).filter(Boolean);
    if (needsCompaction || hasLegacyCopy) persistSnapshots();
  } catch (error) {
    app.snapshots = [];
    console.warn('The saved bestiary could not be loaded.', error);
  }
}
function updateArrangementSummary(metrics, label = 'Best field') {
  if (!metrics) return;
  document.querySelector('#arrangementLabel').innerHTML = `${label} <span class="divider">/</span> ranked`;
  document.querySelector('#stageTitle').textContent = `A field grown around #${String(activeCentroidId()).padStart(2, '0')}.`;
  document.querySelector('#stageSubtitle').textContent = `${metrics.width} × ${metrics.height} / ${metrics.perimeter} coastline edges / ${metrics.enclosure} enclosure / seed ${metrics.centroidFamily} / coast σ ${metrics.radialVariance.toFixed(2)} / gravity ${metrics.gravityTension.toFixed(2)} / inlet ${metrics.inletRisk.toFixed(1)}.`;
}
function addSnapshot(placements, nodes = 0) {
  const signature = snapshotSignature(placements);
  if (app.snapshots.some(snapshot => snapshot.signature === signature)) return false;
  const metrics = fieldMetrics(placements);
  if (!metrics || metrics.holes !== 0 || metrics.centroidEdgeCoast) return false;
  app.snapshots.push({ placements, signature, metrics, nodes });
  app.snapshots.sort((a, b) => (a.metrics?.score ?? Number.POSITIVE_INFINITY) - (b.metrics?.score ?? Number.POSITIVE_INFINITY));
  persistSnapshots();
  const familyId = metrics.centroidFamilyId, piecesView = app.sidebarMode === 'pieces', familyView = app.sidebarMode === 'families', followsSelectedFamily = familyView && !app.arrangementPinned && (!app.selectedFamily || app.selectedFamily === familyId), shouldFollow = piecesView || followsSelectedFamily;
  if (shouldFollow) {
    app.placements = placements;
    if (piecesView) app.selectedFamily = null;
    else app.selectedFamily = familyId;
    renderBoard();
    updateArrangementSummary(metrics, piecesView ? `Arrangement ${String(app.snapshots.indexOf(app.snapshots.find(snapshot => snapshot.signature === signature)) + 1).padStart(2, '0')}` : `Family ${familyId}`);
  }
  renderSnapshots();
  return true;
}
function createSeedPreview(metrics) {
  const centroidId = activeCentroidId(), familyIds = new Set([centroidId]);
  metrics.cells.filter(cell => metrics.map.get(key(cell.x, cell.y)) === centroidId).forEach(cell => adjacent(cell).forEach(next => { const id = metrics.map.get(key(next.x, next.y)); if (id && id !== centroidId) familyIds.add(id); }));
  const visibleCells = metrics.cells.filter(cell => familyIds.has(metrics.map.get(key(cell.x, cell.y))));
  const minX = Math.min(...visibleCells.map(cell => cell.x)), maxX = Math.max(...visibleCells.map(cell => cell.x));
  const minY = Math.min(...visibleCells.map(cell => cell.y)), maxY = Math.max(...visibleCells.map(cell => cell.y));
  const width = maxX - minX + 1, height = maxY - minY + 1;
  const preview = document.createElement('span'); preview.className = 'family-tab-preview seed-glyphs positioned-seed'; preview.style.aspectRatio = `${width} / ${height}`; preview.setAttribute('aria-label', `Centroid #${String(centroidId).padStart(2, '0')} and adjacent shapes ${[...familyIds].filter(id => id !== centroidId).sort((a, b) => a - b).map(id => `#${String(id).padStart(2, '0')}`).join(', ')}`);
  visibleCells.forEach(cell => {
    const id = metrics.map.get(key(cell.x, cell.y)), square = document.createElement('i');
    square.className = `seed-position-cell ${id === activeCentroidId() ? 'centroid' : ''}`; square.style.setProperty('--piece-color', app.pieces.find(piece => piece.id === id)?.color || 'transparent'); square.style.left = `${((cell.x - minX) / width) * 100}%`; square.style.top = `${((cell.y - minY) / height) * 100}%`; square.style.width = `${100 / width}%`; square.style.height = `${100 / height}%`; square.setAttribute('aria-hidden', 'true'); preview.appendChild(square);
  });
  return preview;
}
function createArrangementPreview(metrics, className = 'snapshot-field') {
  const preview = document.createElement('div'); preview.className = className; preview.style.aspectRatio = `${metrics.width} / ${metrics.height}`;
  metrics.cells.forEach(cellData => {
    const cell = document.createElement('i'), id = metrics.map.get(key(cellData.x, cellData.y));
    cell.style.setProperty('--piece-color', app.pieces.find(piece => piece.id === id)?.color || 'transparent'); cell.style.left = `${((cellData.x - metrics.minX) / metrics.width) * 100}%`; cell.style.top = `${((cellData.y - metrics.minY) / metrics.height) * 100}%`; cell.style.width = `${100 / metrics.width}%`; cell.style.height = `${100 / metrics.height}%`; preview.appendChild(cell);
  });
  return preview;
}
function fitPreviewToBox(preview, maxWidth, maxHeight) {
  const [width, height] = preview.style.aspectRatio.split('/').map(Number), scale = Math.min(maxWidth / width, maxHeight / height);
  preview.style.width = `${width * scale}px`; preview.style.height = `${height * scale}px`;
  return preview;
}
function selectSnapshot(snapshot) {
  const metrics = snapshotMetrics(snapshot), index = app.snapshots.indexOf(snapshot);
  hideAtlasHoverCard(); app.placements = snapshot.placements; app.selectedFamily = metrics.centroidFamilyId; app.arrangementPinned = true; app.lastFamilySelections.set(metrics.centroidFamilyId, snapshot.signature); app.sidebarMode = 'families';
  renderSidebarMode(); renderBoard(); renderSnapshots(); updateArrangementSummary(metrics, `Arrangement ${String(index + 1).padStart(2, '0')}`); document.querySelector('#searchStatus').textContent = 'Snapshot restored';
}
function selectAtlasFamily(entry) {
  hideAtlasHoverCard();
  app.neighborBandFilter = entry.neighborCount;
  persistSearchSettings();
  selectFamily(entry.family, entry.snapshots);
}
function selectFamily(family, snapshots) {
  const remembered = app.lastFamilySelections.get(family), snapshot = snapshots.find(item => item.signature === remembered) || snapshots[0];
  if (!snapshot) return;
  const metrics = snapshotMetrics(snapshot);
  app.placements = snapshot.placements; app.selectedFamily = family; app.arrangementPinned = false; app.sidebarMode = 'families';
  renderSidebarMode(); renderBoard(); renderSnapshots(); updateArrangementSummary(metrics, `Family ${family}`); document.querySelector('#searchStatus').textContent = 'Family selected';
}
function renderSnapshots() {
  const root = document.querySelector('#snapshotList'), tabs = document.querySelector('#familyTabs'), detail = document.querySelector('#familyDetail'); root.innerHTML = ''; tabs.innerHTML = ''; detail.innerHTML = '';
  const families = new Map();
  app.snapshots.forEach(snapshot => { const familyId = snapshotFamilyId(snapshot); if (!families.has(familyId)) families.set(familyId, []); families.get(familyId).push(snapshot); });
  const allFamilies = [...families.entries()].filter(([, snapshots]) => snapshots.length);
  const availableNeighborBands = [...new Set(allFamilies.map(([, snapshots]) => snapshotFamilyInfo(snapshots[0]).neighborCount ?? 0))].sort((a, b) => a - b);
  const bandFilter = document.querySelector('#familyBandFilter');
  if (bandFilter) {
    bandFilter.innerHTML = '<option value="">All neighbor bands</option>' + availableNeighborBands.map(count => `<option value="${count}">${count} neighbors</option>`).join('');
    bandFilter.value = app.neighborBandFilter == null || !availableNeighborBands.includes(app.neighborBandFilter) ? '' : String(app.neighborBandFilter);
    bandFilter.disabled = !availableNeighborBands.length;
  }
  const visibleFamilies = allFamilies.filter(([, snapshots]) => app.neighborBandFilter == null || (snapshotFamilyInfo(snapshots[0]).neighborCount ?? 0) === app.neighborBandFilter);
  const orderedFamilies = visibleFamilies.sort((a, b) => { const aMetric = familySortMetric(a[1]), bMetric = familySortMetric(b[1]); return aMetric.primary - bMetric.primary || aMetric.secondary - bMetric.secondary; });
  const currentMetrics = app.placements ? fieldMetrics(app.placements) : null;
  if (!app.selectedFamily || !visibleFamilies.some(([family]) => family === app.selectedFamily)) app.selectedFamily = currentMetrics?.centroidFamilyId && visibleFamilies.some(([family]) => family === currentMetrics.centroidFamilyId) ? currentMetrics.centroidFamilyId : orderedFamilies[0]?.[0] || null;
  orderedFamilies.forEach(([family, snapshots]) => {
    const shell = document.createElement('div'); shell.className = 'family-tab-shell';
    const tabMetrics = snapshotMetrics(snapshots[0]);
    const tab = document.createElement('button'); tab.type = 'button'; tab.className = `family-tab ${family === app.selectedFamily ? 'active' : ''}`; tab.setAttribute('aria-label', `Seed family ${family}, ${snapshots.length} arrangements`); tab.appendChild(createSeedPreview(tabMetrics)); tab.insertAdjacentHTML('beforeend', `<span class="family-tab-copy"><strong>${family}</strong><small>${snapshots.length}</small>${configuredPreferences().length ? `<small>${savedPreferenceMatchCount(snapshots[0])}/${configuredPreferences().length} hints</small>` : ''}</span>`); tab.addEventListener('click', () => selectFamily(family, snapshots));
    const setting = app.familySteering.get(family) || { enabled: false, weight: 1 }, steeringActive = app.searchStrategy !== 'breadth', steer = document.createElement('label'); steer.className = `family-steer-toggle ${steeringActive ? '' : 'inactive'}`; steer.title = steeringActive ? 'Include this family in weighted depth search' : 'Ignored during family breadth'; steer.innerHTML = `<input type="checkbox" aria-label="Include ${family} in weighted depth search" ${setting.enabled ? 'checked' : ''} ${steeringActive ? '' : 'disabled'}><span aria-hidden="true">◎</span>`;
    const checkbox = steer.querySelector('input'); checkbox.addEventListener('click', event => event.stopPropagation()); checkbox.addEventListener('change', event => { app.familySteering.set(family, { enabled: event.target.checked, weight: setting.weight || 1 }); persistFamilySteering(); renderSnapshots(); });
    shell.append(tab, steer); tabs.appendChild(shell);
  });
  const selectedRawSnapshots = orderedFamilies.find(([family]) => family === app.selectedFamily)?.[1] || [];
  const selectedSnapshots = orderedSnapshots(selectedRawSnapshots.slice(0, app.arrangementDisplayLimit)), selectedBest = selectedSnapshots[0] ? snapshotMetrics(selectedSnapshots[0]) : null;
  if (selectedBest) {
    const familyId = selectedBest.centroidFamilyId || app.selectedFamily, setting = app.familySteering.get(familyId) || { enabled: false, weight: 1 };
    const savedHintCount = configuredPreferences().length, matchedHintCount = savedHintCount ? savedPreferenceMatchCount(selectedSnapshots[0]) : 0;
    const steeringSummary = setting.enabled && app.searchStrategy !== 'breadth' ? `weighted depth ${setting.weight.toFixed(1)}× · ` : '';
    detail.innerHTML = `<div class="family-detail-copy"><strong>Seed family ${familyId}</strong><span>${selectedBest.centroidNeighborCount ?? (selectedBest.centroidFamily === 'none' ? 0 : selectedBest.centroidFamily.split(' + ').length)} direct neighbors of #${String(activeCentroidId()).padStart(2, '0')}: ${selectedBest.centroidFamily}</span><small>${steeringSummary}${selectedSnapshots.length} of ${selectedRawSnapshots.length} shown · ${savedHintCount ? `${matchedHintCount}/${savedHintCount} saved directions match · ` : ''}${preferenceSummary()} · best ${selectedBest.perimeter} coast · σ ${selectedBest.radialVariance.toFixed(1)} · inlet risk ${selectedBest.inletRisk.toFixed(1)}</small></div><label class="family-weight-control" for="familyWeightInput">weight <input id="familyWeightInput" type="number" min="0.1" max="5" step="0.1" value="${setting.weight}"></label>`;
    const weightInput = detail.querySelector('#familyWeightInput'); weightInput.addEventListener('change', event => { const weight = Math.min(5, Math.max(.1, Number(event.target.value) || 1)); app.familySteering.set(familyId, { enabled: Boolean(setting.enabled), weight }); persistFamilySteering(); renderSnapshots(); });
  }
  const visibleSnapshots = new Set(selectedSnapshots), variantGroups = arrangementVariantGroups(selectedRawSnapshots);
  for (const group of variantGroups) {
    const visibleEntries = group.entries.filter(entry => visibleSnapshots.has(entry.snapshot));
    if (!visibleEntries.length) continue;
    const section = document.createElement('section'); section.className = 'arrangement-variant-group';
    const changed = group.changedIds.length ? `e.g. moved ${group.changedIds.map(id => `#${String(id).padStart(2, '0')}`).join(' · ')}` : 'reference arrangement';
    section.innerHTML = `<div class="arrangement-variant-heading"><div><strong>Δ${group.difference} · ${group.entries.length} arrangement${group.entries.length === 1 ? '' : 's'}</strong><small>${group.difference ? `${group.difference} piece${group.difference === 1 ? '' : 's'} moved from the family reference` : 'family reference'}</small></div><span>${changed}</span></div>`;
    const list = document.createElement('div'); list.className = 'arrangement-variant-list';
    visibleEntries.forEach(({ snapshot }) => {
      const index = app.snapshots.indexOf(snapshot), metrics = snapshotMetrics(snapshot), card = document.createElement('button'); card.type = 'button'; card.className = `snapshot-card ${app.arrangementPinned && snapshot.placements === app.placements ? 'active' : ''}`;
      const preview = createArrangementPreview(metrics);
      card.appendChild(preview); card.insertAdjacentHTML('beforeend', `<span class="snapshot-caption"><strong>#${String(index + 1).padStart(2, '0')} · ${metrics.perimeter} coast · ${metrics.enclosure}</strong><span>${metrics.width}×${metrics.height} · σ ${metrics.radialVariance.toFixed(1)} · inlet risk ${metrics.inletRisk.toFixed(1)}</span></span>`);
      card.addEventListener('click', () => selectSnapshot(snapshot)); bindArrangementHoverCard(card, snapshot); list.appendChild(card);
    });
    section.appendChild(list); root.appendChild(section);
  }
  if (selectedRawSnapshots.length > selectedSnapshots.length) {
    const more = document.createElement('button'); more.type = 'button'; more.className = 'snapshot-more-button'; more.textContent = `Show ${Math.min(24, selectedRawSnapshots.length - selectedSnapshots.length)} more · ${selectedRawSnapshots.length - selectedSnapshots.length} remain`; more.addEventListener('click', () => { app.arrangementDisplayLimit += 24; renderSnapshots(); }); root.appendChild(more);
  }
  document.querySelector('#snapshotCount').textContent = String(selectedRawSnapshots.length).padStart(2, '0'); document.querySelector('#familyCount').textContent = String(orderedFamilies.length).padStart(2, '0');
  const familyFilterHint = document.querySelector('#familyFilterHint'); if (familyFilterHint) familyFilterHint.textContent = app.neighborBandFilter == null ? `${allFamilies.length} families observed` : `${orderedFamilies.length} of ${allFamilies.length} families · ${app.neighborBandFilter}-neighbor band`;
  const sortControl = document.querySelector('#familySort'); if (sortControl) sortControl.value = app.familySort;
  const arrangementSortControl = document.querySelector('#arrangementSort'); if (arrangementSortControl) arrangementSortControl.value = app.arrangementSort;
  const preferenceToggle = document.querySelector('#preferenceToggle'); if (preferenceToggle) { const active = configuredPreferences().length > 0; preferenceToggle.textContent = app.preferenceEnabled && active ? (app.preferenceMode === 'only' ? `Filter: on · ${configuredPreferences().length}` : `Hints: on · ${configuredPreferences().length}`) : `Hints: off · ${configuredPreferences().length}`; preferenceToggle.classList.toggle('active', app.preferenceEnabled && active); preferenceToggle.setAttribute('aria-pressed', String(app.preferenceEnabled && active)); }
  const preferenceMode = document.querySelector('#preferenceMode'); if (preferenceMode) { preferenceMode.value = app.preferenceMode; preferenceMode.disabled = !configuredPreferences().length; }
  const searchHints = document.querySelector('#searchHints'); if (searchHints) searchHints.checked = app.searchHints;
  const searchStrategy = document.querySelector('#searchStrategy'); if (searchStrategy) searchStrategy.value = app.searchStrategy;
  const familySteeringNote = document.querySelector('#familySteeringNote'); if (familySteeringNote) familySteeringNote.textContent = app.searchStrategy === 'breadth' ? 'ignored during breadth' : 'active for targeted passes';
  const neighborTarget = document.querySelector('#neighborTarget'); if (neighborTarget) neighborTarget.value = app.neighborTarget == null ? '' : String(app.neighborTarget);
  for (const name of ['coastBias', 'gravityBias', 'inletBias']) { const control = document.querySelector(`#${name}`); if (control) control.value = String(app[name]); }
  document.querySelector('#atlasNavCount').textContent = String(allFamilies.length).padStart(2, '0');
  updateSearchTelemetry();
}
function atlasFamilyEntries() {
  const families = new Map();
  app.snapshots.forEach(snapshot => {
    const family = snapshotFamilyId(snapshot);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(snapshot);
  });
  return [...families.entries()].map(([family, snapshots]) => {
    const best = snapshots[0], metrics = snapshotMetrics(best), neighborCount = metrics.centroidNeighborCount ?? (metrics.centroidFamily === 'none' ? 0 : metrics.centroidFamily.split(' + ').length);
    return { family, snapshots, best, neighborCount };
  }).sort((a, b) => snapshotMetrics(a.best).perimeter - snapshotMetrics(b.best).perimeter || snapshotMetrics(a.best).score - snapshotMetrics(b.best).score);
}
let atlasHoverHideTimer = null;
function hideAtlasHoverCard() {
  if (atlasHoverHideTimer) clearTimeout(atlasHoverHideTimer);
  atlasHoverHideTimer = null;
  document.querySelector('.atlas-hover-card')?.remove();
}
function scheduleAtlasHoverCardHide() {
  if (atlasHoverHideTimer) clearTimeout(atlasHoverHideTimer);
  atlasHoverHideTimer = setTimeout(hideAtlasHoverCard, 90);
}
function bindHoverCardDismiss(card) {
  card.addEventListener('mouseenter', () => { if (atlasHoverHideTimer) clearTimeout(atlasHoverHideTimer); atlasHoverHideTimer = null; });
  card.addEventListener('mouseleave', scheduleAtlasHoverCardHide);
  card.querySelector('.hover-card-close')?.addEventListener('click', hideAtlasHoverCard);
}
function positionHoverCard(card, anchor) {
  const margin = 16, desiredWidth = Math.max(360, Math.floor(window.innerWidth * .5)), anchorRect = anchor.getBoundingClientRect(), rightAvailable = window.innerWidth - anchorRect.right - margin, leftAvailable = anchorRect.left - margin, preferRight = anchorRect.left + anchorRect.width / 2 < window.innerWidth / 2;
  const preferred = preferRight ? { side: 'right', available: rightAvailable } : { side: 'left', available: leftAvailable }, alternate = preferRight ? { side: 'left', available: leftAvailable } : { side: 'right', available: rightAvailable }, side = preferred.available >= desiredWidth || preferred.available >= alternate.available ? preferred : alternate;
  const width = Math.max(220, Math.min(desiredWidth, side.available));
  card.style.width = `${width}px`;
  const cardRect = card.getBoundingClientRect();
  let left = side.side === 'right' ? anchorRect.right + margin : anchorRect.left - cardRect.width - margin;
  left = Math.max(margin, Math.min(left, window.innerWidth - cardRect.width - margin));
  let top = anchorRect.top - 8;
  if (top + cardRect.height > window.innerHeight - margin) top = window.innerHeight - cardRect.height - margin;
  top = Math.max(margin, top);
  card.style.left = `${left}px`; card.style.top = `${top}px`;
}
function showAtlasHoverCard(entry, anchor) {
  hideAtlasHoverCard();
  const card = document.createElement('aside'); card.className = 'atlas-hover-card'; card.setAttribute('role', 'tooltip');
  const preview = createSeedPreview(entry.best.metrics); preview.className = 'atlas-hover-seed-preview';
  fitPreviewToBox(preview, Math.min(650, window.innerWidth * .43), 320);
  card.innerHTML = `<button type="button" class="hover-card-close" aria-label="Close preview">×</button><p class="eyebrow accent">Seed family preview</p><div class="atlas-hover-heading"><strong>${entry.family}</strong><span>${entry.neighborCount} neighbors</span></div><div class="atlas-hover-image"></div><div class="atlas-hover-meta"><span>${entry.snapshots.length} arrangement${entry.snapshots.length === 1 ? '' : 's'} banked</span><span>${entry.best.metrics.perimeter} coastline · ${entry.best.metrics.enclosure} enclosure</span></div><small class="atlas-hover-seed">${entry.best.metrics.centroidFamily || 'no adjacent shapes'}</small>`;
  card.querySelector('.atlas-hover-image').appendChild(preview);
  document.body.appendChild(card);
  positionHoverCard(card, anchor); bindHoverCardDismiss(card);
}
function bindAtlasHoverCard(control, entry) {
  const show = () => showAtlasHoverCard(entry, control), hide = () => scheduleAtlasHoverCardHide();
  control.addEventListener('mouseenter', show); control.addEventListener('mouseleave', hide);
  control.addEventListener('focus', show); control.addEventListener('blur', hide);
}
function showArrangementHoverCard(snapshot, anchor) {
  hideAtlasHoverCard();
  const metrics = snapshotMetrics(snapshot), index = app.snapshots.indexOf(snapshot), card = document.createElement('aside'); card.className = 'atlas-hover-card arrangement-hover-card'; card.setAttribute('role', 'tooltip');
  const preview = createArrangementPreview(metrics, 'arrangement-hover-preview'); fitPreviewToBox(preview, Math.min(650, window.innerWidth * .43), 360);
  card.innerHTML = `<button type="button" class="hover-card-close" aria-label="Close preview">×</button><p class="eyebrow accent">Arrangement preview</p><div class="atlas-hover-heading"><strong>Arrangement ${String(index + 1).padStart(2, '0')}</strong><span>${metrics.enclosure} enclosure</span></div><div class="atlas-hover-image arrangement-hover-image"></div><div class="atlas-hover-meta"><span>${metrics.width} × ${metrics.height} field · ${metrics.perimeter} coastline edges</span><span>coast σ ${metrics.radialVariance.toFixed(2)} · gravity ${metrics.gravityTension.toFixed(2)} · center gap ${metrics.centroidSquareOffset.toFixed(2)}</span><span>inlet risk ${metrics.inletRisk.toFixed(2)} · peninsula depth ${metrics.peninsulaDepth}</span><span>family ${metrics.centroidFamilyId} · ${metrics.centroidNeighborCount} centroid neighbors</span></div>`;
  card.querySelector('.arrangement-hover-image').appendChild(preview); document.body.appendChild(card); positionHoverCard(card, anchor); bindHoverCardDismiss(card);
}
function bindArrangementHoverCard(control, snapshot) {
  const show = () => showArrangementHoverCard(snapshot, control), hide = () => scheduleAtlasHoverCardHide();
  control.addEventListener('mouseenter', show); control.addEventListener('mouseleave', hide);
  control.addEventListener('focus', show); control.addEventListener('blur', hide);
}
function renderAtlasView() {
  const plot = document.querySelector('#atlasPlot'), grid = document.querySelector('#atlasFamilyGrid'), summary = document.querySelector('#atlasSummary');
  if (!plot || !grid || !summary) return;
  hideAtlasHoverCard();
  const entries = atlasFamilyEntries();
  summary.innerHTML = `<strong>${entries.length}</strong><span>families observed</span><strong>${app.snapshots.length}</strong><span>arrangements banked</span>`;
  plot.innerHTML = ''; grid.innerHTML = '';
  if (!entries.length) { plot.innerHTML = '<div class="plot-empty">Capture arrangements to populate the observed phase map.</div>'; return; }
  const neighborCounts = [...new Set(entries.map(entry => entry.neighborCount))].sort((a, b) => a - b), bands = new Map(neighborCounts.map((count, index) => [count, { index, entries: [] }]));
  entries.forEach(entry => bands.get(entry.neighborCount).entries.push(entry));
  const minCoast = Math.min(...entries.map(entry => entry.best.metrics.perimeter)), maxCoast = Math.max(...entries.map(entry => entry.best.metrics.perimeter)), coastSpan = Math.max(1, maxCoast - minCoast), maxArrangements = Math.max(1, ...entries.map(entry => entry.snapshots.length)), bandWidth = 80 / neighborCounts.length;
  bands.forEach(band => {
    const columns = Math.min(10, Math.max(1, Math.ceil(Math.sqrt(band.entries.length * 1.8))));
    band.entries.forEach((entry, index) => {
      const column = index % columns, x = 10 + band.index * bandWidth + bandWidth * 0.09 + ((column + .5) / columns) * bandWidth * 0.82;
      const marker = document.createElement('button'); marker.type = 'button'; marker.className = 'atlas-family-marker'; marker.title = `${entry.family}: ${entry.neighborCount} centroid neighbors · ${entry.snapshots.length} arrangements`;
      marker.style.left = `${x}%`; marker.style.top = `${10 + ((entry.best.metrics.perimeter - minCoast) / coastSpan) * 80}%`; marker.style.setProperty('--marker-size', `${30 + Math.min(34, (entry.snapshots.length / maxArrangements) * 34)}px`);
      const preview = createSeedPreview(entry.best.metrics); preview.classList.add('atlas-seed-preview'); marker.appendChild(preview); marker.insertAdjacentHTML('beforeend', `<span class="atlas-marker-label">${entry.family}</span>`); marker.addEventListener('click', () => { selectAtlasFamily(entry); setTopView('solver'); }); bindAtlasHoverCard(marker, entry); plot.appendChild(marker);
      const card = document.createElement('button'); card.type = 'button'; card.className = 'atlas-family-card'; const cardPreview = createSeedPreview(entry.best.metrics); cardPreview.classList.add('atlas-card-preview'); card.appendChild(cardPreview); card.insertAdjacentHTML('beforeend', `<span><strong>${entry.family}</strong><small>${entry.neighborCount} neighbors · ${entry.snapshots.length} arrangements</small><small>${entry.best.metrics.perimeter} coast · ${entry.best.metrics.enclosure}</small></span>`); card.addEventListener('click', () => { selectAtlasFamily(entry); setTopView('solver'); }); bindAtlasHoverCard(card, entry); grid.appendChild(card);
    });
  });
}
function renderPresetEditor() {
  const centroidSelect = document.querySelector('#presetCentroid'), root = document.querySelector('#presetPieceEditor'), title = document.querySelector('#presetEditorTitle'), id = document.querySelector('#presetEditorId'), modified = document.querySelector('#presetModifiedCount');
  if (!centroidSelect || !root || !app.preset) return;
  title.textContent = app.preset.name; id.textContent = app.preset.id; modified.textContent = `${modifiedPieceCount(app.preset)} / ${app.preset.maxModifiedPieces || 3}`;
  centroidSelect.innerHTML = app.preset.pieces.map(piece => `<option value="${piece.permutation}" ${Number(piece.permutation) === activeCentroidId() ? 'selected' : ''}>#${String(piece.permutation).padStart(2, '0')}</option>`).join('');
  root.innerHTML = '';
  app.preset.pieces.forEach(piece => {
    const row = document.createElement('label'); row.className = 'preset-piece-row'; row.innerHTML = `<span class="preset-piece-id">#${String(piece.permutation).padStart(2, '0')}</span><select aria-label="Transform for permutation #${piece.permutation}" data-preset-transform="${piece.permutation}">${PRESET_TRANSFORMS.map(transform => `<option value="${transform}" ${transform === piece.transform ? 'selected' : ''}>${orientationLabel(transform)}</option>`).join('')}</select>${Number(piece.permutation) === activeCentroidId() ? '<span class="preset-centroid-mark">centroid</span>' : ''}`; root.appendChild(row);
  });
  centroidSelect.onchange = event => { if (Number(event.target.value) !== activeCentroidId()) forkPreset({ centroidId: Number(event.target.value) }); };
  root.querySelectorAll('[data-preset-transform]').forEach(select => select.addEventListener('change', event => { const pieces = app.preset.pieces.map(piece => ({ ...piece, transform: Number(piece.permutation) === Number(event.target.dataset.presetTransform) ? event.target.value : piece.transform })); forkPreset({ pieces }); }));
}
function renderMethodView() {
  const telemetry = document.querySelector('#methodTelemetry'); if (!telemetry) return;
  const entries = atlasFamilyEntries();
  telemetry.innerHTML = `<div><strong>${app.totalNodes.toLocaleString()}</strong><span>${app.progressEstimate}</span></div><div><strong>${app.completedPasses.toLocaleString()}</strong><span>completed passes</span></div><div><strong>${entries.length}</strong><span>seed families</span></div><div><strong>${app.neighborTarget == null ? 'any' : `#${app.neighborTarget}`}</strong><span>neighbor target</span></div>`;
  renderPresetEditor();
}
function updateSearchTelemetry() {
  const nodeCount = document.querySelector('#nodeCount'); if (nodeCount) nodeCount.textContent = app.totalNodes ? app.totalNodes.toLocaleString() : '—';
  if (app.topView === 'method') renderMethodView();
}
function setTopView(view) {
  hideAtlasHoverCard();
  app.topView = view;
  const workspace = document.querySelector('.workspace'), solver = document.querySelector('#solverStage'), atlas = document.querySelector('#atlasView'), method = document.querySelector('#methodView');
  workspace.classList.toggle('nav-atlas', view === 'atlas'); workspace.classList.toggle('nav-method', view === 'method');
  solver.hidden = view !== 'solver'; atlas.hidden = view !== 'atlas'; method.hidden = view !== 'method';
  document.querySelector('#solverNav').classList.toggle('active', view === 'solver'); document.querySelector('#atlasNav').classList.toggle('active', view === 'atlas'); document.querySelector('#methodNav').classList.toggle('active', view === 'method');
  if (view === 'atlas') renderAtlasView();
  if (view === 'method') renderMethodView();
}
function renderSidebarMode() {
  const families = app.sidebarMode === 'families';
  document.querySelector('#piecesPanel').hidden = families;
  document.querySelector('#familiesPanel').hidden = !families;
  document.querySelector('#inspectorPanel').hidden = families;
  document.querySelector('#arrangementPanel').hidden = !families;
  document.querySelector('#piecesTab').classList.toggle('active', !families);
  document.querySelector('#familiesTab').classList.toggle('active', families);
  document.querySelector('#piecesTab').setAttribute('aria-selected', String(!families));
  document.querySelector('#familiesTab').setAttribute('aria-selected', String(families));
}
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }

function candidateTranslations(piece, field, bounds) {
  const shape = applyLock(piece), frontier = new Set();
  for (const cellKey of field) { const [x, y] = cellKey.split(',').map(Number); for (const next of adjacent({ x, y })) if (!field.has(key(next.x, next.y))) frontier.add(key(next.x, next.y)); }
  const translations = new Map();
  for (const targetKey of frontier) { const [tx, ty] = targetKey.split(',').map(Number); for (const source of shape) { const origin = { x: tx - source.x, y: ty - source.y }, cells = placedCells(piece, origin), keys = cells.map(c => key(c.x, c.y)); if (keys.some(k => field.has(k)) || translations.has(`${origin.x},${origin.y}`)) continue; const nextBounds = { minX: Math.min(bounds.minX, ...cells.map(c => c.x)), maxX: Math.max(bounds.maxX, ...cells.map(c => c.x)), minY: Math.min(bounds.minY, ...cells.map(c => c.y)), maxY: Math.max(bounds.maxY, ...cells.map(c => c.y)) }; if (nextBounds.maxX - nextBounds.minX + 1 > 24 || nextBounds.maxY - nextBounds.minY + 1 > 16) continue; translations.set(`${origin.x},${origin.y}`, { id: piece.id, origin, cells }); } }
  return [...translations.values()];
}
function isConnected(field) { return field.size === 0 || cellsConnected([...field].map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; })); }

// A bounded randomized growth search. It never reports a result until the
// final union passes the same hole/coast checks used by the renderer.
function searchPacking() {
  const centroidId = activeCentroidId(), centroidPiece = app.pieces.find(p => p.id === centroidId), centerShape = applyLock(centroidPiece), size = shapeSize(centerShape);
  const seedOrigin = { x: -Math.floor(size.width / 2), y: -Math.floor(size.height / 2) }, seedCells = placedCells(centroidPiece, seedOrigin);
  const seed = { placements: [{ id: centroidId, origin: seedOrigin, cells: seedCells }], field: new Set(seedCells.map(c => key(c.x, c.y))), remaining: app.pieces.filter(p => p.id !== centroidId), bounds: fieldMetrics([{ id: centroidId, origin: seedOrigin, cells: seedCells }]) };
  let beam = [seed], nodes = 0;
  for (let depth = 0; depth < activePieceIds().length - 1; depth++) {
    const nextBeam = [];
    for (const state of beam) {
      let selectedPiece = null, selectedCandidates = null;
      for (const piece of state.remaining) {
        const candidates = candidateTranslations(piece, state.field, state.bounds);
        if (!candidates.length) continue;
        if (!selectedCandidates || candidates.length < selectedCandidates.length) { selectedPiece = piece; selectedCandidates = candidates; }
      }
      if (!selectedPiece || !selectedCandidates) continue;
      const seedCellsSet = new Set(seedCells.map(c => key(c.x, c.y)));
      const ranked = selectedCandidates.map(candidate => {
        const newField = new Set(state.field); candidate.cells.forEach(c => newField.add(key(c.x, c.y)));
        const nextPlacements = [...state.placements, candidate];
        const nextBounds = { minX: Math.min(state.bounds.minX, ...candidate.cells.map(c => c.x)), maxX: Math.max(state.bounds.maxX, ...candidate.cells.map(c => c.x)), minY: Math.min(state.bounds.minY, ...candidate.cells.map(c => c.y)), maxY: Math.max(state.bounds.maxY, ...candidate.cells.map(c => c.y)) };
        const contact = candidate.cells.reduce((n, c) => n + adjacent(c).filter(a => state.field.has(key(a.x, a.y))).length, 0);
        const centroidContact = candidate.cells.reduce((n, c) => n + adjacent(c).filter(a => seedCellsSet.has(key(a.x, a.y))).length, 0);
        nodes++;
        return { piece: selectedPiece, candidate, field: newField, placements: nextPlacements, remaining: state.remaining.filter(p => p.id !== selectedPiece.id), nextBounds, score: (nextBounds.maxX - nextBounds.minX + 1) * (nextBounds.maxY - nextBounds.minY + 1) - contact * 2.4 - centroidContact * 6 + Math.random() * 12 };
      }).sort((a, b) => a.score - b.score).slice(0, 24).map(candidate => { const metrics = fieldMetrics(candidate.placements); return metrics.holes === 0 ? { ...candidate, bounds: metrics } : null; }).filter(Boolean);
      nextBeam.push(...ranked);
    }
    if (!nextBeam.length) break;
    nextBeam.sort((a, b) => a.score - b.score); beam = nextBeam.slice(0, 80);
    for (const state of beam) {
      if (state.remaining.length) continue;
      const metrics = fieldMetrics(state.placements);
      if (metrics && metrics.area === activePieceIds().length * AREA && metrics.holes === 0 && !metrics.centroidCoast && isConnected(state.field)) return { placements: state.placements, nodes, metrics };
    }
  }
  return { placements: null, nodes, metrics: null };
}
function showSearchBoard() {
  if (app.placements) { renderBoard(); return; }
  const board = document.querySelector('#board'); board.className = 'board board-empty board-searching'; board.style.gridTemplateColumns = ''; board.style.gridTemplateRows = '';
  board.innerHTML = '<div class="search-visual"><div class="search-glyph"><i></i><i></i><i></i><i></i><i></i></div><strong id="searchDepth">Preparing candidate fields…</strong><small id="searchBeam">The centroid is fixed; the field is growing around it.</small><div class="search-bar"><i id="searchBarFill"></i></div></div>';
}
function setSearchButton(paused = false) {
  const button = document.querySelector('#solveButton'); button.disabled = false; button.innerHTML = paused ? '<span class="spark">Ⅱ</span> Resume auto-search' : '<span class="spark">Ⅱ</span> Pause auto-search';
}
function stopContinuousSearch(message = 'Auto-search paused') {
  app.continuous = false; if (app.searchTimer) clearTimeout(app.searchTimer); app.searchTimer = null;
  const activeWorker = app.searchWorker, activeRequestId = app.searchRequestId;
  if (activeWorker && activeRequestId) {
    activeWorker.postMessage({ type: 'cancel', requestId: activeRequestId, reason: message });
    setTimeout(() => { if (app.searchWorker === activeWorker) { activeWorker.terminate(); app.searchWorker = null; app.searchRequestId = null; app.solving = false; } }, 120);
  } else if (activeWorker) { activeWorker.terminate(); app.searchWorker = null; app.solving = false; }
  app.totalNodes = Math.max(app.totalNodes, app.nodes); persistSearchProgress(true);
  const button = document.querySelector('#solveButton'); button.disabled = false; button.innerHTML = '<span class="spark">✦</span> Find a new arrangement'; document.querySelector('#searchStatus').textContent = message; if (app.placements) renderBoard(); toast(`${message} · ${app.snapshots.length} unique arrangement${app.snapshots.length === 1 ? '' : 's'}`);
}
function launchSearchPass() {
  if (!app.continuous) return;
  app.solving = true; const button = document.querySelector('#solveButton'); setSearchButton(); showSearchBoard(); document.querySelector('#searchStatus').textContent = `Growing candidates · pass ${app.pass + 1}`;
  const worker = new Worker('/apps/field-guide/product/v2-search-worker.js?v=20260810-v2worker22', { type: 'module' }); app.searchWorker = worker; const startingNodes = app.totalNodes, startedAt = performance.now();
  const families = new Map();
  app.snapshots.forEach(snapshot => { const familyId = snapshotFamilyId(snapshot); if (!families.has(familyId)) families.set(familyId, []); families.get(familyId).push(snapshot); });
  const orderedFamilies = [...families.entries()].map(([family, snapshots]) => [family, orderedSnapshots(snapshots)]).filter(([, snapshots]) => snapshots.length).sort((a, b) => { const aMetric = familySortMetric(a[1]), bMetric = familySortMetric(b[1]); return aMetric.primary - bMetric.primary || aMetric.secondary - bMetric.secondary; });
  const checkpointTarget = app.searchCheckpoint ? { familyId: app.searchCheckpoint.targetFamily || null, seed: app.searchCheckpoint.targetSeed || null, threadIndex: Number(app.searchCheckpoint.threadId || 0), searchSalt: app.searchCheckpoint.searchSalt || null } : null;
  const target = app.searchStrategy === 'breadth' ? null : checkpointTarget || nextFamilySteeringTarget(orderedFamilies), knownCentroidFamilies = [...families.keys()];
  const searchSalt = app.searchCheckpoint?.searchSalt || target?.searchSalt || `open:pass-${app.pass}`, requestId = globalThis.crypto?.randomUUID?.() || `product-${Date.now()}-${app.pass}`;
  const ticket = { presetFingerprint: app.preset.id, familyId: target?.familyId || 'open', pass: app.pass, threadId: Number(target?.threadIndex || 0) };
  app.searchRequestId = requestId;
  let protocolResult = null;
  const finish = data => {
    const result = data.result || data;
    const stageReceipts = {
      prefilter: result.prefilter,
      frontier: result.frontier,
      frontierGeneration: result.frontierGeneration,
      frontierTargetGeneration: result.frontierTargetGeneration,
      frontierTargetPool: result.frontierTargetPool,
      frontierMetrics: result.frontierMetrics,
      fieldMetrics: result.fieldMetrics,
      frontierState: result.frontierState,
      frontierTopology: result.frontierTopology,
      frontierRanker: result.frontierRanker,
      frontierScore: result.frontierScore,
      frontierCompactor: result.frontierCompactor,
      frontierDedup: result.frontierDedup,
      navigation: result.navigation,
    };
    const gpuStages = Object.entries(stageReceipts).filter(([, receipt]) => receipt?.status === 'used' || receipt?.status === 'completed' && receipt?.backend === 'webgpu').map(([name]) => name);
    const cpuFallbackStages = Object.entries(stageReceipts).filter(([, receipt]) => receipt?.status === 'fallback' || receipt?.status === 'cpu-oracle' || receipt?.status === 'not-used').map(([name]) => name);
    const cpuFallbackReasons = Object.fromEntries(Object.entries(stageReceipts).filter(([, receipt]) => receipt?.status === 'fallback' || receipt?.status === 'cpu-oracle' || receipt?.status === 'not-used').map(([name, receipt]) => [name, receipt?.reason || receipt?.status || 'unknown']));
    const elapsedMs = Math.max(0, performance.now() - startedAt);
    globalThis.__TDOTDH_V2_LAST_SEARCH_RECEIPT__ = Object.freeze({ schema: 'tdotdh.v2.search-receipt.v1', elapsedMs, gpuStages: Object.freeze(gpuStages), cpuFallbackStages: Object.freeze(cpuFallbackStages), cpuFallbackReasons: Object.freeze(cpuFallbackReasons), ...stageReceipts, placements: Array.isArray(result.placements) ? result.placements.length : 0, nodes: Number(result.nodes) || 0 });
    const runtimeStatus = document.querySelector('#v2RuntimeStatus');
    if (runtimeStatus) {
      runtimeStatus.textContent = `V2 product · real search receipt · ${gpuStages.length} GPU stages · ${cpuFallbackStages.length} CPU fallbacks · ${Math.round(elapsedMs).toLocaleString()} ms`;
      const fallbackText = Object.entries(cpuFallbackReasons).map(([name, reason]) => `${name}=${reason}`).join(', ');
      runtimeStatus.title = `This completed search pass ran ${gpuStages.length} accelerated stage${gpuStages.length === 1 ? '' : 's'} and retained ${cpuFallbackStages.length} CPU/oracle stage${cpuFallbackStages.length === 1 ? '' : 's'}. GPU stages: ${gpuStages.join(', ') || 'none'}. CPU fallbacks: ${cpuFallbackStages.join(', ') || 'none'}. Reasons: ${fallbackText || 'none'}.`;
      runtimeStatus.dataset.backend = gpuStages.length ? 'webgpu-search' : 'cpu-oracle-search';
    }
    if (result.hasPlacement || (Array.isArray(result.placements) && result.placements.length)) app.searchCheckpoint = null;
    else if (result.cursor?.checkpoint) app.searchCheckpoint = result.cursor.checkpoint;
    worker.terminate(); app.searchWorker = null; app.searchRequestId = null; app.solving = false; app.pass++; app.completedPasses++; app.totalNodes = startingNodes + (data.nodes || 0); app.nodes = app.totalNodes; persistSearchProgress(true); updateSearchTelemetry();
    const prefilterLabel = result.prefilter?.status === 'used' ? ' · GPU occupancy prefilter' : result.prefilter?.status === 'fallback' ? ' · CPU occupancy fallback' : result.prefilter?.status === 'not-used' ? ' · CPU seed branch' : '';
    const frontierLabel = result.frontier?.status === 'used' ? ' · GPU frontier validation' : result.frontier?.status === 'fallback' ? ' · CPU frontier validation' : '';
    const generationLabel = result.frontierTargetGeneration?.status === 'used' && result.frontierTargetGeneration?.parity === 'verified' ? ` · GPU target×piece expansion (${Number(result.frontierTargetGeneration.candidateCount || 0).toLocaleString()} candidates)` : result.frontierGeneration?.batch === 'verified' ? ' · GPU batched frontier expansion' : result.frontierGeneration?.compaction === 'verified' ? ' · GPU frontier generation + compaction' : result.frontierGeneration?.status === 'used' ? ' · GPU frontier generation' : result.frontierGeneration?.status === 'fallback' ? ' · CPU frontier generation' : '';
    const metricsLabel = result.frontierMetrics?.status === 'used' ? ' · GPU frontier geometry' : result.frontierMetrics?.status === 'fallback' ? ' · CPU frontier geometry' : '';
    const fieldMetricsLabel = result.fieldMetrics?.status === 'used' ? ' · GPU field aggregates' : result.fieldMetrics?.status === 'fallback' ? ' · CPU field aggregates' : '';
    const stateLabel = result.frontierState?.finalCanonicalParity === 'verified' ? ' · GPU labeled state + canonical acceptance' : result.frontierState?.status === 'used' ? ` · ${result.frontierState.resident ? 'resident ' : result.frontierState.persistent ? 'persistent ' : ''}GPU state transition` : result.frontierState?.status === 'fallback' ? ' · CPU state transition' : '';
    const topologyLabel = result.frontierTopology?.status === 'used' ? ' · GPU topology occupancy' : result.frontierTopology?.status === 'fallback' ? ' · CPU topology fallback' : '';
    const rankerLabel = result.frontierRanker?.status === 'used' ? ' · GPU deterministic ranking' : result.frontierRanker?.status === 'fallback' ? ' · CPU ranking fallback' : '';
    const scoreLabel = result.frontierScore?.status === 'used' ? ' · GPU candidate scoring' : result.frontierScore?.status === 'fallback' ? ' · CPU score fallback' : '';
    const compactorLabel = result.frontierCompactor?.status === 'used' ? ` · ${result.frontierCompactor.persistent ? 'persistent ' : ''}GPU ${result.frontierCompactor.batch === 'breadth-quota' ? 'family-quota' : 'beam'} compaction` : result.frontierCompactor?.status === 'fallback' ? ' · CPU beam compaction fallback' : '';
    const navigationLabel = result.navigation?.expansionOwnership === 'gpu-owned' ? ` · ${result.navigation.gpuExpansionBatches || result.navigation.batchCount || 0} GPU-owned expansion batches · CPU canonical replay verified` : result.navigation?.status === 'checkpointed' ? ` · ${result.navigation.batchCount || 0} navigation batches · coordinator checkpoint saved` : result.navigation?.canonicalReplay === 'verified' ? ` · ${result.navigation.batchCount || 0} navigation batches · CPU-oracle replay verified` : '';
    const labels = `${prefilterLabel}${frontierLabel}${generationLabel}${metricsLabel}${fieldMetricsLabel}${stateLabel}${topologyLabel}${rankerLabel}${scoreLabel}${compactorLabel}${navigationLabel}`;
    if (result.hasPlacement || (Array.isArray(result.placements) && result.placements.length)) { const added = addSnapshot(result.placements, result.nodes); document.querySelector('#searchStatus').textContent = added ? `Arrangement ${String(app.snapshots.length).padStart(2, '0')} captured · continuing search${labels}` : `Duplicate cover skipped · continuing search${labels}`; if (added) toast(`Arrangement ${String(app.snapshots.length).padStart(2, '0')} captured and ranked`); }
    else document.querySelector('#searchStatus').textContent = `Pass ${app.pass} complete · continuing search${labels}`;
    if (app.continuous) app.searchTimer = setTimeout(launchSearchPass, 80);
  };
  worker.onmessage = event => { const data = event.data; if (data.type === 'progress') { app.nodes = startingNodes + data.nodes; if (data.cursor?.checkpoint) app.searchCheckpoint = data.cursor.checkpoint; if (app.nodes - app.lastPersistedNodes >= 5000) { app.totalNodes = app.nodes; persistSearchProgress(true); } updateSearchTelemetry(); document.querySelector('#searchStatus').textContent = `Exploring pass ${app.pass + 1} · depth ${data.depth} / 14`; const depth = document.querySelector('#searchDepth'), beam = document.querySelector('#searchBeam'), bar = document.querySelector('#searchBarFill'); if (depth) depth.textContent = `Pass ${app.pass + 1} · layer ${data.depth} / 14`; if (beam) beam.textContent = `${data.frontier || 0} GPU frontier candidates · ${data.families || 0} centroid seed families · ${data.nodes.toLocaleString()} placements checked`; if (bar) bar.style.width = `${Math.min(100, (data.depth / 14) * 100)}%`; } else if (data.type === 'result') protocolResult = data; else if (data.type === 'completed') finish(protocolResult || data); else if (data.type === 'cancelled') { if (data.cursor?.checkpoint) app.searchCheckpoint = data.cursor.checkpoint; worker.terminate(); app.searchWorker = null; app.searchRequestId = null; app.solving = false; persistSearchProgress(true); document.querySelector('#searchStatus').textContent = 'Search cancelled safely'; } else if (data.type === 'failed') { worker.terminate(); app.searchWorker = null; app.searchRequestId = null; app.solving = false; document.querySelector('#searchStatus').textContent = `Search failed · ${data.error?.message || 'worker error'}`; } else if (data.type === 'done') finish(data); };
  worker.onerror = () => { worker.terminate(); app.searchWorker = null; app.searchRequestId = null; app.solving = false; if (app.continuous) { document.querySelector('#searchStatus').textContent = 'Worker restarted safely · continuing search'; app.searchTimer = setTimeout(launchSearchPass, 120); } else stopContinuousSearch('Search stopped safely'); };
  worker.postMessage({ type: 'start', protocolVersion: 1, requestId, presetFingerprint: app.preset.id, catalogRevision: `field-guide:${app.preset.id}:v2`, seed: searchSalt, mode: app.searchStrategy === 'breadth' ? 'breadth' : 'depth', operation: 'product-search', ticket, cursor: { depth: 0, nodeOffset: 0, rootChoice: Number(target?.threadIndex || 0), ...(app.searchCheckpoint ? { checkpoint: app.searchCheckpoint } : {}) }, budget: { maxNodes: 10000000, maxMilliseconds: 900000 }, pieces: app.pieces, knownSignatureHints: app.snapshots.map(snapshot => snapshot.signature || snapshotSignature(snapshot.placements)), steering: { centroidId: activeCentroidId(), knownCentroidFamilies, searchHints: app.searchHints, searchStrategy: app.searchStrategy, targetNeighborCount: app.neighborTarget, targetFamily: target?.familyId || null, targetSeed: target?.seed || null, positionPreferences: Object.fromEntries(configuredPreferences().map(preference => [preference.pieceId, preference.direction])), positionLocks: Object.fromEntries(app.positionLocks.entries()), coastBias: app.coastBias, gravityBias: app.gravityBias, inletBias: app.inletBias } });
}
function solve() { if (app.continuous) { stopContinuousSearch(); return; } app.continuous = true; app.pass = 0; app.familySteeringPass = 0; setSearchButton(); document.querySelector('#searchStatus').textContent = 'Growing connected candidates'; showSearchBoard(); launchSearchPass(); }
function resetApp() { if (app.searchWorker) app.searchWorker.terminate(); if (app.searchTimer) clearTimeout(app.searchTimer); app.searchWorker = null; app.searchTimer = null; app.solving = false; app.continuous = false; app.searchCheckpoint = null; app.sidebarMode = 'pieces'; app.selectedFamily = null; app.arrangementPinned = false; app.placements = app.snapshots[0]?.placements || null; app.nodes = app.totalNodes; app.pass = 0; persistSearchProgress(true); document.querySelector('#solveButton').disabled = false; document.querySelector('#solveButton').innerHTML = '<span class="spark">✦</span> Find a new arrangement'; document.querySelector('#searchStatus').textContent = app.snapshots.length ? `Ready to search · ${app.snapshots.length} banked` : 'Ready to search'; document.querySelector('#arrangementLabel').innerHTML = 'Variable field <span class="divider">/</span> source-locked'; document.querySelector('#stageTitle').textContent = 'Search the open field.'; document.querySelector('#stageSubtitle').textContent = `No rectangle is prescribed. Find a dense connected packing with zero internal holes and #${String(activeCentroidId()).padStart(2, '0')} away from every coast.`; renderBoard(); renderSnapshots(); renderSidebarMode(); if (app.placements) updateArrangementSummary(app.snapshots[0].metrics); }

initializePresetState(); restoreSearchSettings(); app.pieces = createPieces(); restorePositionPreferences(); restorePositionLocks(); restoreFamilySteering(); restoreSnapshots(); restoreSearchProgress(); app.placements = app.snapshots[0]?.placements || null; renderPresetIdentity(); renderPieceList(); renderBoard(); renderInspector(); renderSnapshots(); renderSidebarMode(); if (app.placements) updateArrangementSummary(app.snapshots[0].metrics);
document.querySelector('#solveButton').addEventListener('click', solve);
document.querySelector('#resetButton').addEventListener('click', resetApp);
document.querySelector('#helpButton').addEventListener('click', () => document.querySelector('#helpDialog').showModal()); document.querySelector('#closeDialog').addEventListener('click', () => document.querySelector('#helpDialog').close());
document.querySelector('#piecesTab').addEventListener('click', () => { app.sidebarMode = 'pieces'; app.selectedFamily = null; app.arrangementPinned = false; renderSidebarMode(); });
document.querySelector('#familiesTab').addEventListener('click', () => { app.sidebarMode = 'families'; renderSidebarMode(); renderSnapshots(); });
document.querySelector('#familySort').addEventListener('change', event => { app.familySort = event.target.value; persistSearchSettings(); renderSnapshots(); });
document.querySelector('#arrangementSort').addEventListener('change', event => { app.arrangementSort = event.target.value; persistSearchSettings(); renderSnapshots(); });
document.querySelector('#familyBandFilter').addEventListener('change', event => { app.neighborBandFilter = event.target.value ? Number(event.target.value) : null; persistSearchSettings(); renderSnapshots(); });
document.querySelector('#preferenceMode').addEventListener('change', event => { app.preferenceMode = event.target.value; persistSearchSettings(); renderSnapshots(); });
document.querySelector('#preferenceToggle').addEventListener('click', () => {
  if (!configuredPreferences().length) { toast('Choose a direction for at least one piece first'); return; }
  app.preferenceEnabled = !app.preferenceEnabled; persistSearchSettings();
  renderSnapshots();
});
document.querySelector('#searchHints').addEventListener('change', event => { app.searchHints = event.target.checked; persistSearchSettings(); renderSnapshots(); });
document.querySelector('#searchStrategy').addEventListener('change', event => { app.searchStrategy = event.target.value; persistSearchSettings(); renderSnapshots(); });
document.querySelector('#neighborTarget').addEventListener('change', event => { app.neighborTarget = event.target.value ? Number(event.target.value) : null; persistSearchSettings(); renderSnapshots(); });
for (const name of ['coastBias', 'gravityBias', 'inletBias']) document.querySelector(`#${name}`).addEventListener('change', event => { app[name] = Math.min(5, Math.max(0, Number(event.target.value) || 0)); persistSearchSettings(); renderSnapshots(); });
document.querySelector('#solverNav').addEventListener('click', () => setTopView('solver'));
document.querySelector('#atlasNav').addEventListener('click', () => setTopView('atlas'));
document.querySelector('#methodNav').addEventListener('click', () => setTopView('method'));
document.addEventListener('keydown', event => { if (event.key === 'Escape') hideAtlasHoverCard(); });
window.addEventListener('resize', fitBoardToViewport);
if (window.ResizeObserver) new ResizeObserver(fitBoardToViewport).observe(document.querySelector('.board-frame'));
