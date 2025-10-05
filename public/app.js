const state = {
  characters: [],
  characterMap: new Map(),
  classes: {},
  selectedClass: 'All',
  lastRolled: null,
  missingForSelection: [],
  customSelection: null,
};

const classSelectEl = document.getElementById('classSelect');
const rollBtn = document.getElementById('rollBtn');
const previewGridEl = document.getElementById('previewGrid');
const resultEl = document.getElementById('result');
const noticeBarEl = document.getElementById('noticeBar');

window.addEventListener('DOMContentLoaded', () => {
  initializeApp().catch((error) => {
    console.error(error);
    showNotice('Unable to load data. Please refresh the page.');
    renderResult(null, { message: 'Data failed to load.' });
  });
});

async function initializeApp() {
  rollBtn.disabled = true;
  renderResult(null, { message: 'Choose a class and press roll.' });
  await loadData();
  populateClassSelect();
  setClass(state.selectedClass);
  rollBtn.disabled = false;

  classSelectEl.addEventListener('change', (event) => {
    setClass(event.target.value);
  });

  rollBtn.addEventListener('click', () => {
    roll();
  });

  rollBtn.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      roll();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'r') {
      rollBtn.focus({ preventScroll: true });
      roll();
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

  state.characters = characters;
  state.characterMap = new Map(characters.map((entry) => [entry.id, entry]));
  state.classes = classes ?? {};

  if (!state.classes.All) {
    state.classes = { All: [], ...state.classes };
  }

  return { characters, classes };
}

export function setClass(name) {
  state.selectedClass = name;
  classSelectEl.value = name;
  state.missingForSelection = [];

  const pool = getPool();
  renderPreviewGrid(pool);

  const shouldKeepRoll = state.lastRolled && pool.includes(state.lastRolled);
  renderResult(shouldKeepRoll ? state.lastRolled : null, {
    message: pool.length ? 'Press roll to pick a fighter.' : 'No fighters available.',
  });

  if (!shouldKeepRoll) {
    state.lastRolled = null;
  }

  if (state.missingForSelection.length) {
    const humanized = state.missingForSelection.map(humanizeId).join(', ');
    showNotice(`Missing portraits for: ${humanized}`);
  } else {
    hideNotice();
  }
}

export function getPool() {
  const customPool = getCustomClassPool();
  if (Array.isArray(customPool)) {
    return customPool;
  }

  if (!state.classes || !Object.keys(state.classes).length) {
    return state.characters;
  }

  const classMembers = state.classes[state.selectedClass];
  if (!classMembers || state.selectedClass === 'All' || classMembers.length === 0) {
    return state.characters;
  }

  const pool = [];
  const missing = [];

  for (const id of classMembers) {
    const character = state.characterMap.get(id);
    if (character) {
      pool.push(character);
    } else {
      missing.push(id);
    }
  }

  state.missingForSelection = missing;
  return pool;
}

export function roll() {
  const pool = getPool();
  if (!pool.length) {
    state.lastRolled = null;
    renderResult(null, { message: 'No fighters available in this pool.' });
    return;
  }

  const randomIndex = Math.floor(Math.random() * pool.length);
  const character = pool[randomIndex];
  state.lastRolled = character;
  renderResult(character);
}

export function renderPreviewGrid(pool) {
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

function populateClassSelect() {
  const classNames = Object.keys(state.classes)
    .filter(Boolean)
    .sort((a, b) => {
      if (a === 'All') return -1;
      if (b === 'All') return 1;
      return a.localeCompare(b);
    });

  classSelectEl.innerHTML = '';

  for (const className of classNames) {
    const option = document.createElement('option');
    option.value = className;
    option.textContent = className;
    if (className === state.selectedClass) {
      option.selected = true;
    }
    classSelectEl.appendChild(option);
  }
}


function showNotice(message) {
  noticeBarEl.hidden = false;
  noticeBarEl.textContent = message;
}

function hideNotice() {
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

function getCustomClassPool() {
  // TODO: return an array of characters when a custom class selection is active.
  return null;
}
