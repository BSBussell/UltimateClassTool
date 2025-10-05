const LS_KEY = 'smash.customClasses.v1';

const state = {
  allChars: [],
  characterMap: new Map(),
  builtinClasses: {},
  customClasses: {},
  selectedClass: 'All',
  lastRolled: null,
  missingForSelection: [],
  customMode: false,
  customSelection: new Set(),
};

const classSelectEl = document.getElementById('classSelect');
const rollBtn = document.getElementById('rollBtn');
const previewGridEl = document.getElementById('previewGrid');
const resultEl = document.getElementById('result');
const noticeBarEl = document.getElementById('noticeBar');
const customBtnEl = document.getElementById('customClassBtn');
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

  window.addEventListener('keydown', (event) => {
    if (event.key && event.key.toLowerCase() === 'r' && !state.customMode) {
      rollBtn?.focus({ preventScroll: true });
      roll();
    }
  });

  customBtnEl?.addEventListener('click', handleCustomButton);
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
  const [characters, classes] = await Promise.all([
    fetchJson('characters.json'),
    fetchJson('classes.json'),
  ]);

  if (!Array.isArray(characters)) {
    throw new Error('characters.json must be an array');
  }

  state.allChars = characters.slice();
  state.characterMap = new Map(state.allChars.map((entry) => [entry.id, entry]));
  state.builtinClasses = classes ?? {};
  if (!state.builtinClasses.All) {
    state.builtinClasses.All = [];
  }

  loadCustomClasses();
  state.selectedClass = 'All';
}

function loadCustomClasses() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      state.customClasses = {};
      return;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      state.customClasses = {};
      return;
    }
    const cleaned = {};
    for (const [name, ids] of Object.entries(parsed)) {
      if (Array.isArray(ids)) {
        cleaned[name] = ids.filter((id) => typeof id === 'string');
      }
    }
    state.customClasses = cleaned;
  } catch (error) {
    console.warn('Failed to read custom classes, clearing storage.', error);
    state.customClasses = {};
  }
}

function saveCustomClasses() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state.customClasses));
  } catch (error) {
    console.warn('Failed to save custom classes.', error);
  }
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
  const { pool, missing } = resolvePool(state.selectedClass);
  state.missingForSelection = missing;

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

export function renderPreviewGrid(pool) {
  if (!previewGridEl) return;
  previewGridEl.innerHTML = '';

  if (!pool.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'preview-empty';
    emptyState.textContent = 'No fighters in this class.';
    previewGridEl.appendChild(emptyState);
    return;
  }

  for (const character of pool) {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.setAttribute('role', 'listitem');

    const portrait = createPortrait(character, {
      loading: 'lazy',
      scale: 1.28,
      classes: ['preview'],
    });

    item.appendChild(portrait);
    previewGridEl.appendChild(item);
  }
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

function handleCustomButton() {
  if (state.customMode) {
    exitCustomMode();
    return;
  }

  enterCustomMode();
}


function isCustomClass(name) {
  return !!state.customClasses[name];
}

function enterCustomMode() {
  if (!customEditorEl || !customGridEl) return;
  state.customMode = true;
  state.customSelection = new Set();
  customEditorEl.hidden = false;
  renderCustomGrid();
  if (customGridEl) {
    if (typeof customGridEl.scrollTo === 'function') {
      customGridEl.scrollTo({ top: 0 });
    } else {
      customGridEl.scrollTop = 0;
    }
  }
  if (customNameInput) {
    customNameInput.value = '';
    customNameInput.focus();
  }
  updateCustomButtonState();
}

function exitCustomMode() {
  if (!state.customMode) return;
  state.customMode = false;
  state.customSelection = new Set();
  if (customEditorEl) {
    customEditorEl.hidden = true;
  }
  if (customNameInput) {
    customNameInput.value = '';
  }
  updateCustomButtonState();
}

function renderCustomGrid() {
  if (!customGridEl) return;
  customGridEl.innerHTML = '';

  for (const character of state.allChars) {
    const selected = state.customSelection.has(character.id);
    const tile = document.createElement('div');
    tile.className = 'preview-item custom-preview-item';
    if (!selected) {
      tile.classList.add('preview-item--inactive');
    }
    tile.dataset.id = character.id;
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.setAttribute('aria-pressed', String(selected));

    const portrait = createPortrait(character, {
      loading: 'lazy',
      scale: 1.28,
      classes: ['preview'],
    });

    tile.appendChild(portrait);

    tile.addEventListener('click', () => toggleCustomPick(character.id, tile));
    tile.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        toggleCustomPick(character.id, tile);
      }
    });

    customGridEl.appendChild(tile);
  }
}

function toggleCustomPick(id, tileEl) {
  const isSelected = state.customSelection.has(id);
  if (isSelected) {
    state.customSelection.delete(id);
    tileEl.classList.add('preview-item--inactive');
    tileEl.setAttribute('aria-pressed', 'false');
  } else {
    state.customSelection.add(id);
    tileEl.classList.remove('preview-item--inactive');
    tileEl.setAttribute('aria-pressed', 'true');
  }
}

function saveCustomClass() {
  if (!customEditorEl) return;
  const name = (customNameInput?.value || '').trim();
  if (!name) {
    alert('Please enter a class name.');
    return;
  }
  if (state.customSelection.size === 0) {
    alert('Select at least one fighter.');
    return;
  }

  if (state.builtinClasses[name]) {
    const ok = confirm(`A built-in class named "${name}" exists. Save as "${name} (Custom)" instead?`);
    if (!ok) return;
    saveSelectionAs(`${name} (Custom)`);
    return;
  }

  if (state.customClasses[name]) {
    const overwrite = confirm(`Overwrite existing custom class "${name}"?`);
    if (!overwrite) return;
  }

  saveSelectionAs(name);
}

function saveSelectionAs(name) {
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
  const showCustomButton = !isCustom || state.customMode;

  if (customBtnEl) {
    customBtnEl.classList.remove('primary-btn', 'secondary-btn');
    customBtnEl.toggleAttribute('hidden', !showCustomButton);

    if (state.customMode) {
      customBtnEl.textContent = 'Cancel Custom Mode';
      customBtnEl.classList.add('secondary-btn');
    } else {
      customBtnEl.textContent = 'Custom Class';
      customBtnEl.classList.add('primary-btn');
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
}
