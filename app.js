const LS_KEY = 'smash.customClasses.v1';
const LS_SET_KEY = 'smash.customClassSets.v1';
const SHARE_PARAM = 'cset';
const SHARE_VERSION = 1;
const SHARE_VERSION_TOKEN = SHARE_VERSION.toString(36);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const state = {
  allChars: [],
  characterMap: new Map(),
  builtinClasses: {},
  classSets: [],
  classSetMap: new Map(),
  activeClassSetId: null,
  customClassesBySet: {},
  customClasses: {},
  selectedClass: 'All',
  lastRolled: null,
  missingForSelection: [],
  customMode: false,
  customSelection: new Set(),
  customEditingClassName: null,
};

const classSelectEl = document.getElementById('classSelect');
const classSetSelectEl = document.getElementById('classSetSelect');
const rollBtn = document.getElementById('rollBtn');
const previewGridEl = document.getElementById('previewGrid');
const previewTitleEl = document.getElementById('previewTitle');
const resultEl = document.getElementById('result');
const noticeBarEl = document.getElementById('noticeBar');
const createCustomSetBtnEl = document.getElementById('createCustomSetBtn');
const exportCustomSetBtnEl = document.getElementById('exportCustomSetBtn');
const deleteCustomSetBtnEl = document.getElementById('deleteCustomSetBtn');
const customRulesDividerEl = document.getElementById('customRulesDivider');
const customBtnEl = document.getElementById('customClassBtn');
const editCustomBtnEl = document.getElementById('editCustomBtn');
const deleteCustomBtnEl = document.getElementById('deleteCustomBtn');
const customEditorEl = document.getElementById('custom-class-editor');
const customGridEl = document.getElementById('customGrid');
const customNameInput = document.getElementById('customName');
const saveCustomBtn = document.getElementById('saveCustomBtn');
const cancelCustomBtn = document.getElementById('cancelCustomBtn');

window.addEventListener('DOMContentLoaded', () => {
  initializeApp().catch((error) => {
    console.error(error);
    showNotice('Unable to load data. Please refresh the page.');
    renderResult(null, { message: 'Data failed to load.' });
  });
});

async function initializeApp() {
  if (rollBtn) {
    rollBtn.disabled = true;
  }
  renderResult(null, { message: 'Choose a class and press roll.' });

  await loadData();
  await importSharedClassSetFromHash();
  refreshClassSetDropdown();
  refreshClassDropdown();
  setClass(state.selectedClass);

  if (rollBtn) {
    rollBtn.disabled = false;
    rollBtn.addEventListener('click', roll);
    rollBtn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        roll();
      }
    });
  }

  classSelectEl?.addEventListener('change', (event) => {
    setClass(event.target.value);
  });
  classSetSelectEl?.addEventListener('change', (event) => {
    setClassSet(event.target.value);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key && event.key.toLowerCase() === 'r' && !state.customMode) {
      rollBtn?.focus({ preventScroll: true });
      roll();
    }
  });

  customBtnEl?.addEventListener('click', handleCustomButton);
  editCustomBtnEl?.addEventListener('click', handleEditCustomButton);
  createCustomSetBtnEl?.addEventListener('click', createCustomSet);
  exportCustomSetBtnEl?.addEventListener('click', () => {
    exportActiveCustomClassSet().catch((error) => {
      console.error(error);
      alert('Unable to export this custom class set.');
    });
  });
  deleteCustomSetBtnEl?.addEventListener('click', deleteCustomSet);
  deleteCustomBtnEl?.addEventListener('click', () => deleteCustomClass(state.selectedClass));
  saveCustomBtn?.addEventListener('click', saveCustomClass);
  cancelCustomBtn?.addEventListener('click', () => {
    exitCustomMode();
    customBtnEl?.focus({ preventScroll: true });
  });
  customNameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveCustomClass();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      exitCustomMode();
      customBtnEl?.focus({ preventScroll: true });
    }
  });
}

export async function loadData() {
  const [characters, classSource] = await Promise.all([
    fetchJson('characters.json'),
    fetchJson('classes.json'),
  ]);

  if (!Array.isArray(characters)) {
    throw new Error('characters.json must be an array');
  }

  state.allChars = characters.slice();
  state.characterMap = new Map(state.allChars.map((entry) => [entry.id, entry]));
  const { sets: builtinSets, defaultSetId } = normalizeClassSets(classSource);
  const customSets = loadCustomClassSets();
  const mergedSets = mergeClassSets(builtinSets, customSets);
  state.classSets = mergedSets;
  state.classSetMap = new Map(mergedSets.map((set) => [set.id, set]));
  loadCustomClasses(defaultSetId);
  applyActiveClassSet(defaultSetId);
}

function applyActiveClassSet(requestedId, options = {}) {
  const { preferredClass } = options;

  if (!state.classSets.length) {
    state.builtinClasses = { All: [] };
    state.activeClassSetId = null;
    state.customClasses = {};
    state.selectedClass = 'All';
    return;
  }

  const fallbackSet = state.classSetMap.get(requestedId) ?? state.classSets[0];
  const activeSet = fallbackSet ?? state.classSets[0];
  state.activeClassSetId = activeSet?.id ?? null;
  state.builtinClasses = activeSet?.classes ?? { All: [] };
  syncActiveCustomClasses();

  const classNames = new Set(Object.keys(state.builtinClasses));
  Object.keys(state.customClasses || {}).forEach((name) => {
    if (name) {
      classNames.add(name);
    }
  });
  let nextClass = 'All';

  if (preferredClass && classNames.has(preferredClass)) {
    nextClass = preferredClass;
  } else if (activeSet?.defaultClass && classNames.has(activeSet.defaultClass)) {
    nextClass = activeSet.defaultClass;
  } else if (classNames.size) {
    nextClass = classNames.has('All') ? 'All' : Array.from(classNames)[0];
  }

  state.selectedClass = nextClass;
}

function normalizeClassSets(source) {
  const map = new Map();
  const defaultCandidates = [];
  const reservedKeys = new Set(['defaultSet', 'default', 'version']);

  const addSet = (id, name, classes, defaultClass, isDefault = false) => {
    const safeId = coerceSetId(id, map.size);
    const label = name || safeId;
    const sanitizedClasses = sanitizeClassMap(classes);
    const resolvedDefault = resolveDefaultClass(sanitizedClasses, defaultClass);
    const entry = {
      id: safeId,
      name: label,
      classes: sanitizedClasses,
      defaultClass: resolvedDefault,
      isDefault: Boolean(isDefault),
      isCustom: false,
    };

    map.set(safeId, entry);
    if (entry.isDefault) {
      defaultCandidates.push(safeId);
    }
  };

  const parseSetCandidate = (candidate, fallbackId) => {
    if (!candidate || typeof candidate !== 'object') return;
    const id = candidate.id ?? fallbackId;
    const name = candidate.name ?? candidate.label ?? fallbackId;
    const classes =
      candidate.classes ??
      candidate.classMap ??
      candidate.data ??
      candidate.pools ??
      candidate.set ??
      candidate;
    const isDefault =
      candidate.default === true || candidate.isDefault === true || candidate.primary === true;
    const defaultClass =
      candidate.defaultClass ??
      candidate.initialClass ??
      candidate.startClass ??
      candidate.activeClass ??
      candidate.defaultSelection;

    addSet(id, name, classes, defaultClass, isDefault);
  };

  if (Array.isArray(source)) {
    source.forEach((entry, index) => parseSetCandidate(entry, `set-${index + 1}`));
  } else if (source && typeof source === 'object') {
    const setsSource = source.sets;
    if (Array.isArray(setsSource)) {
      setsSource.forEach((entry, index) => parseSetCandidate(entry, `set-${index + 1}`));
    } else if (setsSource && typeof setsSource === 'object') {
      Object.entries(setsSource).forEach(([key, value]) => parseSetCandidate(value, key));
    } else {
      const entries = Object.entries(source).filter(([key]) => !reservedKeys.has(key));
      const entriesWithValues = entries.filter(([, value]) => value !== undefined);
      const arraysOnly =
        entriesWithValues.length > 0 &&
        entriesWithValues.every(([, value]) => Array.isArray(value));

      if (arraysOnly) {
        addSet('default', 'Default', source, source.defaultClass ?? 'All', true);
      } else {
        let detected = false;
        for (const [key, value] of entries) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
          detected = true;
          parseSetCandidate(value, key);
        }
        if (!detected) {
          addSet('default', 'Default', source, source.defaultClass ?? 'All');
        }
      }
    }
  } else {
    addSet('default', 'Default', {}, 'All');
  }

  if (!map.size) {
    addSet('default', 'Default', source, 'All');
  }

  const sets = Array.from(map.values());
  let defaultSetId = null;
  const explicitDefault =
    typeof source === 'object' && source
      ? source.defaultSet ?? source.default
      : null;
  if (typeof explicitDefault === 'string' && map.has(explicitDefault)) {
    defaultSetId = explicitDefault;
  } else {
    const candidate = defaultCandidates.find((id) => map.has(id));
    if (candidate) {
      defaultSetId = candidate;
    } else if (sets.length) {
      defaultSetId = sets[0].id;
    }
  }

  return { sets, defaultSetId };
}

function sanitizeClassMap(source) {
  const result = {};
  if (!source || typeof source !== 'object') {
    result.All = [];
    return result;
  }

  for (const [name, list] of Object.entries(source)) {
    if (!Array.isArray(list)) continue;
    const filtered = list.filter((id) => typeof id === 'string' && id.trim().length);
    result[name] = filtered;
  }

  if (!Object.prototype.hasOwnProperty.call(result, 'All')) {
    result.All = [];
  }

  return result;
}

function resolveDefaultClass(classMap, requested) {
  const classNames = Object.keys(classMap);
  if (requested && classNames.includes(requested)) {
    return requested;
  }
  if (classNames.includes('All')) {
    return 'All';
  }
  return classNames[0] ?? 'All';
}

function coerceSetId(value, index) {
  if (typeof value === 'string' && value.trim().length) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return `set-${index + 1}`;
}

function mergeClassSets(builtinSets, customSets) {
  const merged = [];
  const usedIds = new Set();

  for (const set of builtinSets) {
    const id = reserveUniqueSetId(set.id, usedIds, merged.length);
    merged.push({
      ...set,
      id,
      isCustom: false,
    });
  }

  for (const set of customSets) {
    const id = reserveUniqueSetId(set.id, usedIds, merged.length);
    merged.push({
      ...set,
      id,
      isCustom: true,
      isDefault: false,
    });
  }

  return merged;
}

function reserveUniqueSetId(requestedId, usedIds, indexHint = 0) {
  const base = coerceSetId(requestedId, indexHint);
  let candidate = base;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

function loadCustomClassSets() {
  try {
    const raw = localStorage.getItem(LS_SET_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sets) ? parsed.sets : [];
    const loaded = [];
    const usedIds = new Set();

    source.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;

      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (!name) return;

      const classes = sanitizeClassMap(entry.classes ?? entry.classMap ?? entry.data ?? {});
      const defaultClass = resolveDefaultClass(
        classes,
        entry.defaultClass ?? entry.initialClass ?? entry.startClass,
      );
      const id = reserveUniqueSetId(entry.id ?? `custom-set-${index + 1}`, usedIds, index);

      loaded.push({
        id,
        name,
        classes,
        defaultClass,
        isDefault: false,
        isCustom: true,
      });
    });

    return loaded;
  } catch (error) {
    console.warn('Failed to read custom class sets, clearing storage.', error);
    return [];
  }
}

function saveCustomClassSets() {
  try {
    const payload = state.classSets
      .filter((set) => set.isCustom)
      .map((set) => ({
        id: set.id,
        name: set.name,
        defaultClass: resolveDefaultClass(set.classes ?? {}, set.defaultClass),
        classes: sanitizeClassMap(set.classes ?? {}),
      }));

    localStorage.setItem(LS_SET_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to save custom class sets.', error);
  }
}

function loadCustomClasses(defaultSetId = null) {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      state.customClassesBySet = {};
      state.customClasses = {};
      return;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      state.customClassesBySet = {};
      state.customClasses = {};
      return;
    }

    const bySetSource =
      parsed.bySet && typeof parsed.bySet === 'object' ? parsed.bySet : null;
    const cleanedBySet = {};

    if (bySetSource) {
      for (const [setId, classes] of Object.entries(bySetSource)) {
        const cleanSetId = typeof setId === 'string' ? setId.trim() : '';
        if (!cleanSetId) continue;
        cleanedBySet[cleanSetId] = sanitizeCustomClassMap(classes);
      }
    } else {
      // Legacy format: a single global custom-class map; attach it to the default/first set.
      const targetSetId = defaultSetId ?? state.classSets[0]?.id ?? 'default';
      cleanedBySet[targetSetId] = sanitizeCustomClassMap(parsed);
    }

    state.customClassesBySet = cleanedBySet;
    state.customClasses = {};
  } catch (error) {
    console.warn('Failed to read custom classes, clearing storage.', error);
    state.customClassesBySet = {};
    state.customClasses = {};
  }
}

function saveCustomClasses() {
  try {
    const normalized = {};
    for (const [setId, classes] of Object.entries(state.customClassesBySet || {})) {
      const cleanSetId = typeof setId === 'string' ? setId.trim() : '';
      if (!cleanSetId) continue;
      normalized[cleanSetId] = sanitizeCustomClassMap(classes);
    }
    localStorage.setItem(LS_KEY, JSON.stringify({ bySet: normalized }));
  } catch (error) {
    console.warn('Failed to save custom classes.', error);
  }
}

function sanitizeCustomClassMap(source) {
  const result = {};
  if (!source || typeof source !== 'object') {
    return result;
  }

  for (const [name, ids] of Object.entries(source)) {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName || cleanName === 'All' || !Array.isArray(ids)) continue;
    const filtered = ids.filter((id) => typeof id === 'string' && id.trim().length);
    result[cleanName] = filtered;
  }

  return result;
}

function getCustomClassesForSet(setId) {
  if (!setId) {
    return {};
  }
  const existing = state.customClassesBySet[setId];
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    state.customClassesBySet[setId] = {};
  }
  return state.customClassesBySet[setId];
}

function syncActiveCustomClasses() {
  state.customClasses = getCustomClassesForSet(state.activeClassSetId);
}

function refreshClassSetDropdown() {
  if (!classSetSelectEl) return;
  classSetSelectEl.innerHTML = '';

  for (const set of state.classSets) {
    const option = document.createElement('option');
    option.value = set.id;
    option.textContent = set.name;
    classSetSelectEl.appendChild(option);
  }

  const activeId = state.activeClassSetId ?? state.classSets[0]?.id ?? '';
  if (activeId) {
    classSetSelectEl.value = activeId;
  }
  classSetSelectEl.disabled = state.classSets.length === 0;
}

function refreshClassDropdown() {
  if (!classSelectEl) return;
  const names = getAllClassNames();
  if (!names.includes(state.selectedClass)) {
    state.selectedClass = 'All';
  }

  classSelectEl.innerHTML = '';
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    classSelectEl.appendChild(option);
  }
  classSelectEl.value = state.selectedClass;
  updateCustomButtonState();
}

function getAllClassNames() {
  const names = new Set(['All']);
  Object.keys(state.builtinClasses || {}).forEach((name) => {
    if (name && name !== 'All') {
      names.add(name);
    }
  });
  Object.keys(state.customClasses || {}).forEach((name) => {
    if (name) {
      names.add(name);
    }
  });
  return Array.from(names).sort((a, b) => {
    if (a === 'All') return -1;
    if (b === 'All') return 1;
    return a.localeCompare(b);
  });
}

function setClassSet(requestedId) {
  if (!requestedId) return;
  const previousClass = state.selectedClass;
  applyActiveClassSet(requestedId, { preferredClass: previousClass });
  if (classSetSelectEl) {
    classSetSelectEl.value = state.activeClassSetId ?? '';
    classSetSelectEl.disabled = state.classSets.length === 0;
  }
  refreshClassDropdown();
  setClass(state.selectedClass);
}

export function setClass(name) {
  const available = getAllClassNames();
  const target = available.includes(name) ? name : 'All';
  state.selectedClass = target;
  if (classSelectEl) {
    classSelectEl.value = target;
  }
  updateCustomButtonState();
  updatePoolAndGrid();
}

function updatePoolAndGrid() {
  if (state.customMode) {
    const available = state.allChars.filter((fighter) => !state.customSelection.has(fighter.id));
    state.missingForSelection = [];
    updatePreviewTitle();
    renderCustomGrid();
    renderPreviewGrid(available, { interactive: true });
    renderResult(null, { message: 'Select fighters from the preview, then save your custom class.' });
    hideNotice();
    return;
  }

  const { pool, missing } = resolvePool(state.selectedClass);
  state.missingForSelection = missing;

  updatePreviewTitle();
  renderPreviewGrid(pool);

  const stillValid = state.lastRolled && pool.some((fighter) => fighter.id === state.lastRolled.id);
  renderResult(stillValid ? state.lastRolled : null, {
    message: pool.length ? 'Press roll to pick a fighter.' : 'No fighters available.',
  });

  if (!stillValid) {
    state.lastRolled = null;
  }

  if (missing.length) {
    const humanized = missing.map(humanizeId).join(', ');
    showNotice(`Missing portraits for: ${humanized}`);
  } else {
    hideNotice();
  }
}

export function roll() {
  const { pool } = resolvePool(state.selectedClass);
  if (!pool.length) {
    state.lastRolled = null;
    renderResult(null, { message: 'No fighters available in this pool.' });
    return;
  }

  const pick = pool[Math.floor(Math.random() * pool.length)];
  state.lastRolled = pick;
  renderResult(pick);
}

function resolvePool(className) {
  if (!className || className === 'All') {
    return { pool: state.allChars.slice(), missing: [] };
  }

  let ids = [];
  if (state.customClasses[className]) {
    ids = state.customClasses[className];
  } else if (state.builtinClasses[className]) {
    ids = state.builtinClasses[className];
  }

  if (!Array.isArray(ids) || !ids.length) {
    return { pool: state.allChars.slice(), missing: [] };
  }

  const pool = [];
  const missing = [];

  for (const id of ids) {
    const entry = state.characterMap.get(id);
    if (entry) {
      pool.push(entry);
    } else {
      missing.push(id);
    }
  }

  return { pool, missing };
}

export function renderPreviewGrid(pool, options = {}) {
  const { interactive = false } = options;
  if (!previewGridEl) return;
  previewGridEl.innerHTML = '';

  if (!pool.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'preview-empty';
    emptyState.textContent = state.customMode
      ? 'All fighters are already in this custom class.'
      : 'No fighters in this class.';
    previewGridEl.appendChild(emptyState);
    return;
  }

  for (const character of pool) {
    const item = document.createElement('div');
    item.className = interactive ? 'preview-item preview-item--selectable' : 'preview-item';
    if (interactive) {
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-pressed', 'false');
      item.addEventListener('click', () => addToCustomSelection(character.id));
      item.addEventListener('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          addToCustomSelection(character.id);
        }
      });
    } else {
      item.setAttribute('role', 'listitem');
    }

    const portrait = createPortrait(character, {
      loading: 'lazy',
      scale: 1.28,
      classes: ['preview'],
    });

    item.appendChild(portrait);
    previewGridEl.appendChild(item);
  }
}

function updatePreviewTitle() {
  if (!previewTitleEl) return;
  previewTitleEl.textContent = state.customMode ? 'Available Fighters' : 'Class Preview';
}

export function renderResult(character, options = {}) {
  const { message } = options;
  if (!resultEl) return;
  resultEl.className = 'result-card';
  resultEl.innerHTML = '';

  if (!character) {
    resultEl.classList.remove('slam-in');
    resultEl.classList.add('empty');
    resultEl.textContent = message ?? 'Awaiting roll.';
    return;
  }

  resultEl.classList.remove('empty');
  resultEl.classList.remove('slam-in');

  const hero = document.createElement('div');
  hero.className = 'roll-hero';

  const portrait = createPortrait(character, {
    loading: 'eager',
    scale: 1.18,
    classes: ['hero'],
    decoding: 'sync',
  });

  const details = document.createElement('div');
  details.className = 'hero-details';

  const label = document.createElement('div');
  label.className = 'hero-label';
  label.textContent = `Rolled from ${state.selectedClass}`;

  details.appendChild(label);
  hero.appendChild(portrait);
  hero.appendChild(details);

  resultEl.appendChild(hero);

  requestAnimationFrame(() => {
    resultEl.classList.add('slam-in');
  });
}

export function humanizeId(id) {
  return id
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function showNotice(message) {
  if (!noticeBarEl) return;
  noticeBarEl.hidden = false;
  noticeBarEl.textContent = message;
}

function hideNotice() {
  if (!noticeBarEl) return;
  noticeBarEl.hidden = true;
  noticeBarEl.textContent = '';
}

function fetchJson(url) {
  return fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    return response.json();
  });
}

function createPortrait(character, options = {}) {
  const frame = document.createElement('div');
  frame.className = 'portrait-frame';
  if (Array.isArray(options.classes)) {
    for (const className of options.classes) {
      frame.classList.add(className);
    }
  }

  if (options.aspect) {
    frame.style.setProperty('--portrait-aspect', options.aspect);
  }
  if (options.scale) {
    frame.style.setProperty('--portrait-scale', String(options.scale));
  }

  const img = document.createElement('img');
  img.className = 'portrait';
  img.src = character.file;
  img.alt = humanizeId(character.id);
  img.decoding = options.decoding ?? 'async';
  img.loading = options.loading ?? 'lazy';

  frame.appendChild(img);
  applyPortraitFocus(img, character.focus);
  return frame;
}

function applyPortraitFocus(img, focus) {
  if (!isValidFocus(focus)) {
    img.style.removeProperty('--focus-x');
    img.style.removeProperty('--focus-y');
    img.style.removeProperty('object-position');
    img.style.removeProperty('transform-origin');
    return;
  }

  const update = () => {
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) {
      return;
    }
    const percentX = clamp((focus.x / width) * 100, 0, 100);
    const percentY = clamp((focus.y / height) * 100, 0, 100);
    const valueX = `${percentX}%`;
    const valueY = `${percentY}%`;
    img.style.setProperty('--focus-x', valueX);
    img.style.setProperty('--focus-y', valueY);
    img.style.objectPosition = `${valueX} ${valueY}`;
    img.style.transformOrigin = `${valueX} ${valueY}`;
  };

  if (img.complete && img.naturalWidth) {
    update();
  } else {
    img.addEventListener('load', update, { once: true });
  }
}

function isValidFocus(focus) {
  return (
    focus &&
    typeof focus.x === 'number' &&
    typeof focus.y === 'number' &&
    Number.isFinite(focus.x) &&
    Number.isFinite(focus.y)
  );
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createCustomSet() {
  if (state.customMode) {
    const leaveEditor = confirm('Exit custom class mode and create a blank class set?');
    if (!leaveEditor) return;
    exitCustomMode();
  }

  const requestedName = prompt('Enter a name for the custom class set.');
  if (requestedName === null) return;

  const name = requestedName.trim();
  if (!name) {
    alert('Please enter a set name.');
    return;
  }

  const existing = state.classSets.find((set) => set.name.toLowerCase() === name.toLowerCase());
  if (existing && !existing.isCustom) {
    alert(`A built-in class set named "${existing.name}" already exists. Choose a different name.`);
    return;
  }

  const classes = { All: [] };
  const defaultClass = 'All';

  if (existing?.isCustom) {
    const overwrite = confirm(`Overwrite existing custom class set "${existing.name}"?`);
    if (!overwrite) return;

    existing.name = name;
    existing.classes = classes;
    existing.defaultClass = defaultClass;
    state.customClassesBySet[existing.id] = {};

    state.classSetMap.set(existing.id, existing);
    saveCustomClasses();
    saveCustomClassSets();
    refreshClassSetDropdown();
    setClassSet(existing.id);
    return;
  }

  const setId = generateCustomSetId(name);
  const nextSet = {
    id: setId,
    name,
    classes,
    defaultClass,
    isDefault: false,
    isCustom: true,
  };

  state.classSets.push(nextSet);
  state.classSetMap.set(setId, nextSet);
  state.customClassesBySet[setId] = {};
  saveCustomClasses();
  saveCustomClassSets();
  refreshClassSetDropdown();
  setClassSet(setId);
}

function generateCustomSetId(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const base = `custom-${slug || 'set'}`;
  let candidate = base;
  let suffix = 2;

  while (state.classSetMap.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

async function exportActiveCustomClassSet() {
  const activeSet = state.activeClassSetId ? state.classSetMap.get(state.activeClassSetId) : null;
  if (!activeSet?.isCustom) {
    alert('Select a custom class set to export.');
    return;
  }

  const payload = normalizeSharedClassSetPayload({
    v: SHARE_VERSION,
    set: {
      name: activeSet.name,
      idHint: activeSet.id,
      defaultClass: resolveDefaultClass(activeSet.classes ?? {}, activeSet.defaultClass),
      classes: sanitizeClassMap(activeSet.classes ?? {}),
    },
    customClasses: sanitizeCustomClassMap(getCustomClassesForSet(activeSet.id)),
  });

  const token = await encodeSharedClassSetPayload(payload);
  const shareUrl = buildSharedClassSetUrl(token);
  const copied = await copyTextToClipboard(shareUrl);

  if (copied) {
    alert('Custom class set link copied to clipboard.');
  } else {
    alert(`Unable to copy automatically. Share this URL:\n${shareUrl}`);
  }
}

async function importSharedClassSetFromHash() {
  const token = getSharedClassSetTokenFromHash();
  if (!token) return null;

  try {
    const payload = await decodeSharedClassSetToken(token);
    const result = upsertImportedClassSet(payload);
    if (!result?.setId) {
      hideNotice();
      clearSharedClassSetHash();
      return null;
    }

    saveCustomClasses();
    saveCustomClassSets();
    applyActiveClassSet(result.setId, { preferredClass: payload.set.defaultClass });
    clearSharedClassSetHash();
    showNotice(`Imported custom class set "${result.name}" from link.`);
    return result.setId;
  } catch (error) {
    console.warn('Failed to import shared custom class set.', error);
    hideNotice();
    clearSharedClassSetHash();
    alert('Shared custom class set link is invalid or corrupted.');
    return null;
  }
}

function upsertImportedClassSet(payload) {
  const importedName = payload?.set?.name?.trim();
  if (!importedName) {
    throw new Error('Imported set is missing a valid name.');
  }

  const importedClasses = sanitizeClassMap(payload.set.classes ?? {});
  const importedDefaultClass = resolveDefaultClass(importedClasses, payload.set.defaultClass);
  const importedCustomClasses = sanitizeCustomClassMap(payload.customClasses ?? {});
  const targetNameLower = importedName.toLowerCase();

  const existingCustom = state.classSets.find(
    (set) => set.isCustom && set.name.toLowerCase() === targetNameLower,
  );

  if (existingCustom) {
    const overwrite = confirm(
      `A custom class set named "${existingCustom.name}" already exists. Overwrite it with the imported set?`,
    );
    if (overwrite) {
      existingCustom.name = importedName;
      existingCustom.classes = importedClasses;
      existingCustom.defaultClass = importedDefaultClass;
      state.customClassesBySet[existingCustom.id] = importedCustomClasses;
      state.classSetMap.set(existingCustom.id, existingCustom);
      return { setId: existingCustom.id, name: existingCustom.name };
    }

    const copyName = generateImportedSetName(importedName);
    return createImportedClassSet(copyName, importedClasses, importedDefaultClass, importedCustomClasses);
  }

  const existingBuiltin = state.classSets.find(
    (set) => !set.isCustom && set.name.toLowerCase() === targetNameLower,
  );
  if (existingBuiltin) {
    const importAsCopy = confirm(
      `A built-in class set named "${existingBuiltin.name}" already exists. Import this as a copy instead?`,
    );
    if (!importAsCopy) {
      return { setId: null, name: null };
    }
    const copyName = generateImportedSetName(importedName);
    return createImportedClassSet(copyName, importedClasses, importedDefaultClass, importedCustomClasses);
  }

  return createImportedClassSet(importedName, importedClasses, importedDefaultClass, importedCustomClasses);
}

function createImportedClassSet(name, classes, defaultClass, customClasses) {
  const setId = generateCustomSetId(name);
  const nextSet = {
    id: setId,
    name,
    classes: sanitizeClassMap(classes),
    defaultClass: resolveDefaultClass(classes, defaultClass),
    isDefault: false,
    isCustom: true,
  };

  state.classSets.push(nextSet);
  state.classSetMap.set(setId, nextSet);
  state.customClassesBySet[setId] = sanitizeCustomClassMap(customClasses);
  return { setId, name };
}

function generateImportedSetName(baseName) {
  const trimmed = typeof baseName === 'string' ? baseName.trim() : '';
  const root = trimmed || 'Custom Set';
  const stem = `${root} (Imported)`;
  const takenNames = new Set(state.classSets.map((set) => set.name.toLowerCase()));
  let candidate = stem;
  let suffix = 2;

  while (takenNames.has(candidate.toLowerCase())) {
    candidate = `${stem} ${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function getSharedClassSetTokenFromHash() {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#')) {
    return null;
  }

  const params = new URLSearchParams(hash.slice(1));
  const value = params.get(SHARE_PARAM);
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function clearSharedClassSetHash() {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#')) {
    return;
  }

  const params = new URLSearchParams(hash.slice(1));
  if (!params.has(SHARE_PARAM)) {
    return;
  }

  params.delete(SHARE_PARAM);
  const nextHash = params.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`;
  history.replaceState(null, '', nextUrl);
}

function buildSharedClassSetUrl(token) {
  return `${window.location.origin}${window.location.pathname}${window.location.search}#${SHARE_PARAM}=${token}`;
}

async function encodeSharedClassSetPayload(payload) {
  const normalized = normalizeSharedClassSetPayload(payload);
  const compact = packSharedClassSetPayload(normalized);
  const jsonBytes = textEncoder.encode(JSON.stringify(compact));
  const body = bytesToBase64Url(jsonBytes);
  return `${SHARE_VERSION_TOKEN}${body}`;
}

async function decodeSharedClassSetToken(token) {
  let body = '';

  // Current compact format: "<version-token><base64url-json>".
  const currentVersion = parseInt(token.charAt(0), 36);
  if (Number.isFinite(currentVersion) && currentVersion === SHARE_VERSION) {
    body = token.slice(1);
  } else {
    // Backward compatibility for older generated links.
    const legacyPrefix = `v${SHARE_VERSION}.`;
    const shortLegacyPrefix = `${SHARE_VERSION}.`;
    if (token.startsWith(legacyPrefix)) {
      body = token.slice(legacyPrefix.length);
    } else if (token.startsWith(shortLegacyPrefix)) {
      body = token.slice(shortLegacyPrefix.length);
    } else {
      throw new Error('Unsupported shared token format.');
    }
  }

  const jsonBytes = base64UrlToBytes(body);
  if (!jsonBytes) {
    throw new Error('Invalid encoded payload.');
  }

  let parsed;
  try {
    parsed = JSON.parse(textDecoder.decode(jsonBytes));
  } catch (error) {
    throw new Error('Invalid JSON payload.');
  }

  const expanded = unpackSharedClassSetPayload(parsed);
  return normalizeSharedClassSetPayload(expanded);
}

function packSharedClassSetPayload(payload) {
  return [
    payload.set.name,
    payload.set.defaultClass,
    classMapToEntries(payload.set.classes, { includeAll: true }),
    classMapToEntries(payload.customClasses, { includeAll: false }),
  ];
}

function unpackSharedClassSetPayload(source) {
  if (!Array.isArray(source)) {
    return source;
  }

  const [name, defaultClass, setEntries, customEntries] = source;
  return {
    v: SHARE_VERSION,
    set: {
      name: typeof name === 'string' ? name : '',
      defaultClass: typeof defaultClass === 'string' ? defaultClass : 'All',
      classes: entriesToClassMap(setEntries, { includeAll: true }),
    },
    customClasses: entriesToClassMap(customEntries, { includeAll: false }),
  };
}

function classMapToEntries(source, options = {}) {
  const { includeAll = false } = options;
  const out = [];
  if (!source || typeof source !== 'object') {
    return out;
  }

  for (const [name, ids] of Object.entries(source)) {
    if (!Array.isArray(ids)) continue;
    if (!includeAll && name === 'All') continue;
    out.push([name, ids]);
  }

  return out;
}

function entriesToClassMap(source, options = {}) {
  const { includeAll = false } = options;
  const out = {};
  if (!Array.isArray(source)) {
    if (includeAll) {
      out.All = [];
    }
    return out;
  }

  for (const entry of source) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [name, ids] = entry;
    if (typeof name !== 'string' || !Array.isArray(ids)) continue;
    if (!includeAll && name === 'All') continue;
    out[name] = ids;
  }

  if (includeAll && !Object.prototype.hasOwnProperty.call(out, 'All')) {
    out.All = [];
  }
  return out;
}

function normalizeSharedClassSetPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Shared payload is not an object.');
  }

  const version = payload.v;
  if (version !== SHARE_VERSION && version !== String(SHARE_VERSION)) {
    throw new Error(`Unsupported payload version "${version}".`);
  }

  const setSource = payload.set;
  if (!setSource || typeof setSource !== 'object') {
    throw new Error('Shared payload is missing set data.');
  }

  const setName = typeof setSource.name === 'string' ? setSource.name.trim() : '';
  if (!setName) {
    throw new Error('Shared payload is missing a valid set name.');
  }

  const classes = sanitizeClassMap(setSource.classes ?? {});
  const defaultClass = resolveDefaultClass(classes, setSource.defaultClass);
  const idHint = typeof setSource.idHint === 'string' ? setSource.idHint.trim() : '';
  const customClasses = sanitizeCustomClassMap(payload.customClasses ?? {});

  return {
    v: SHARE_VERSION,
    set: {
      name: setName,
      idHint,
      defaultClass,
      classes,
    },
    customClasses,
  };
}

function bytesToBase64Url(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  if (typeof value !== 'string' || !value.length) {
    return null;
  }

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = normalized.length % 4;
  const padded = normalized + (padLength ? '='.repeat(4 - padLength) : '');

  let binary = '';
  try {
    binary = atob(padded);
  } catch (error) {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      // Fall through to legacy copy behavior.
    }
  }
  return fallbackCopyText(value);
}

function fallbackCopyText(value) {
  if (!document.body || typeof document.execCommand !== 'function') {
    return false;
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.setAttribute('readonly', 'readonly');
  textArea.style.position = 'fixed';
  textArea.style.top = '0';
  textArea.style.left = '-9999px';

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    copied = false;
  }

  document.body.removeChild(textArea);
  return copied;
}

function deleteCustomSet() {
  const activeSetId = state.activeClassSetId;
  if (!activeSetId) return;

  const activeSet = state.classSetMap.get(activeSetId);
  if (!activeSet?.isCustom) return;

  const ok = confirm(`Delete custom class set "${activeSet.name}"?`);
  if (!ok) return;

  if (state.customMode) {
    exitCustomMode();
  }

  state.classSets = state.classSets.filter((set) => set.id !== activeSetId);
  state.classSetMap.delete(activeSetId);
  delete state.customClassesBySet[activeSetId];
  saveCustomClasses();
  saveCustomClassSets();

  const nextSetId = state.classSets[0]?.id ?? null;
  if (nextSetId) {
    setClassSet(nextSetId);
    return;
  }

  applyActiveClassSet(null);
  refreshClassSetDropdown();
  refreshClassDropdown();
  setClass(state.selectedClass);
}

function handleCustomButton() {
  if (state.customMode) {
    exitCustomMode();
    return;
  }

  enterCustomMode();
}

function handleEditCustomButton() {
  if (state.customMode) {
    exitCustomMode();
    return;
  }
  if (!isCustomClass(state.selectedClass)) {
    return;
  }
  enterCustomMode({ editingClassName: state.selectedClass });
}


function isCustomClass(name) {
  return !!state.customClasses[name];
}

function enterCustomMode(options = {}) {
  if (!customEditorEl || !customGridEl) return;
  const requestedEditName =
    typeof options.editingClassName === 'string' ? options.editingClassName.trim() : '';
  const editName = requestedEditName && isCustomClass(requestedEditName) ? requestedEditName : null;
  state.customMode = true;
  state.customEditingClassName = editName;
  if (editName) {
    const existingIds = Array.isArray(state.customClasses[editName]) ? state.customClasses[editName] : [];
    const filtered = existingIds.filter((id) => typeof id === 'string' && id.trim().length);
    state.customSelection = new Set(filtered);
  } else {
    state.customSelection = new Set();
  }
  customEditorEl.hidden = false;
  if (customGridEl) {
    if (typeof customGridEl.scrollTo === 'function') {
      customGridEl.scrollTo({ top: 0 });
    } else {
      customGridEl.scrollTop = 0;
    }
  }
  if (customNameInput) {
    customNameInput.value = editName ?? '';
    customNameInput.focus();
    if (editName) {
      customNameInput.select();
    }
  }
  updateCustomButtonState();
  updatePoolAndGrid();
}

function exitCustomMode() {
  if (!state.customMode) return;
  state.customMode = false;
  state.customSelection = new Set();
  state.customEditingClassName = null;
  if (customEditorEl) {
    customEditorEl.hidden = true;
  }
  if (customNameInput) {
    customNameInput.value = '';
  }
  updateCustomButtonState();
  updatePoolAndGrid();
}

function renderCustomGrid() {
  if (!customGridEl) return;
  customGridEl.innerHTML = '';

  const selectedCharacters = state.allChars.filter((character) =>
    state.customSelection.has(character.id),
  );

  if (!selectedCharacters.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'preview-empty';
    emptyState.textContent = 'Your custom class is empty. Add fighters from Available Fighters below.';
    customGridEl.appendChild(emptyState);
    return;
  }

  for (const character of selectedCharacters) {
    const tile = document.createElement('div');
    tile.className = 'preview-item custom-preview-item preview-item--selectable';
    tile.dataset.id = character.id;
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.setAttribute('aria-pressed', 'true');

    const portrait = createPortrait(character, {
      loading: 'lazy',
      scale: 1.28,
      classes: ['preview'],
    });

    tile.appendChild(portrait);

    tile.addEventListener('click', () => removeFromCustomSelection(character.id));
    tile.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        removeFromCustomSelection(character.id);
      }
    });

    customGridEl.appendChild(tile);
  }
}

function addToCustomSelection(id) {
  if (!state.customMode || state.customSelection.has(id)) return;
  state.customSelection.add(id);
  updatePoolAndGrid();
}

function removeFromCustomSelection(id) {
  if (!state.customMode || !state.customSelection.has(id)) return;
  state.customSelection.delete(id);
  updatePoolAndGrid();
}

function saveCustomClass() {
  if (!customEditorEl) return;
  const editingName =
    typeof state.customEditingClassName === 'string' ? state.customEditingClassName : null;
  const name = (customNameInput?.value || '').trim();
  if (!name) {
    alert('Please enter a class name.');
    return;
  }
  if (state.customSelection.size === 0) {
    alert('Select at least one fighter.');
    return;
  }

  if (state.builtinClasses[name] && name !== editingName) {
    const ok = confirm(`A built-in class named "${name}" exists. Save as "${name} (Custom)" instead?`);
    if (!ok) return;
    saveSelectionAs(`${name} (Custom)`);
    return;
  }

  if (state.customClasses[name] && name !== editingName) {
    const overwrite = confirm(`Overwrite existing custom class "${name}"?`);
    if (!overwrite) return;
  }

  saveSelectionAs(name);
}

function saveSelectionAs(name) {
  const editingName =
    typeof state.customEditingClassName === 'string' ? state.customEditingClassName : null;
  if (editingName && editingName !== name && isCustomClass(editingName)) {
    delete state.customClasses[editingName];
  }
  state.customClasses[name] = Array.from(state.customSelection);
  saveCustomClasses();
  exitCustomMode();
  refreshClassDropdown();
  setClass(name);
}

function deleteCustomClass(name) {
  if (!isCustomClass(name)) return;
  const ok = confirm(`Delete custom class "${name}"?`);
  if (!ok) return;
  delete state.customClasses[name];
  saveCustomClasses();
  if (state.customMode) {
    exitCustomMode();
  }
  refreshClassDropdown();
  setClass('All');
}

function updateCustomButtonState() {
  const isCustom = isCustomClass(state.selectedClass);
  const showDelete = isCustom && !state.customMode;
  const showCustomButton = true;
  const showEditButton = isCustom && !state.customMode;
  const activeSet = state.activeClassSetId ? state.classSetMap.get(state.activeClassSetId) : null;
  const showDeleteSet = Boolean(activeSet?.isCustom);
  const showExportSet = Boolean(activeSet?.isCustom) && !state.customMode;

  if (createCustomSetBtnEl) {
    createCustomSetBtnEl.disabled = state.customMode;
  }

  if (deleteCustomSetBtnEl) {
    deleteCustomSetBtnEl.toggleAttribute('hidden', !showDeleteSet);
    if (showDeleteSet && !state.customMode) {
      deleteCustomSetBtnEl.removeAttribute('disabled');
    } else {
      deleteCustomSetBtnEl.setAttribute('disabled', 'disabled');
    }
  }

  if (exportCustomSetBtnEl) {
    exportCustomSetBtnEl.toggleAttribute('hidden', !showExportSet);
    if (showExportSet) {
      exportCustomSetBtnEl.removeAttribute('disabled');
    } else {
      exportCustomSetBtnEl.setAttribute('disabled', 'disabled');
    }
  }

  if (customBtnEl) {
    customBtnEl.classList.remove('primary-btn', 'secondary-btn');
    customBtnEl.toggleAttribute('hidden', !showCustomButton);

    if (state.customMode) {
      customBtnEl.textContent = 'Cancel Custom Mode';
      customBtnEl.classList.add('secondary-btn');
    } else {
      customBtnEl.textContent = 'Create Custom Class';
      customBtnEl.classList.add('primary-btn');
    }
  }

  if (editCustomBtnEl) {
    editCustomBtnEl.toggleAttribute('hidden', !showEditButton);
    if (showEditButton) {
      editCustomBtnEl.removeAttribute('disabled');
    } else {
      editCustomBtnEl.setAttribute('disabled', 'disabled');
    }
  }

  if (deleteCustomBtnEl) {
    deleteCustomBtnEl.toggleAttribute('hidden', !showDelete);
    if (showDelete) {
      deleteCustomBtnEl.removeAttribute('disabled');
    } else {
      deleteCustomBtnEl.setAttribute('disabled', 'disabled');
    }
  }

  if (customRulesDividerEl) {
    customRulesDividerEl.toggleAttribute('hidden', !(showDelete || showDeleteSet));
  }
}
