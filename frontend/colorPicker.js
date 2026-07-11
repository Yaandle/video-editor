// colorPicker.js — embeddable HSV color picker, ported from vidhtml.html reference.
// createColorPicker(containerEl, { initialColor, onChange, onCommit })
//
// Three swatch rows below the SV/hue/hex controls, matching the reference:
//   Recent  — auto-populated ~250ms after a color settles (localStorage, ambient history)
//   Palette — fixed brand presets (not user-editable)
//   Saved   — colors explicitly pinned via "+ Add Current" (localStorage — see §7 tradeoff:
//             per-browser, not portable via .vkit)

const RECENT_KEY = 'vidkit_recent_colors';
const MAX_RECENT = 9;
const SAVED_KEY = 'vidkit_saved_colors';
const MAX_SAVED = 50;
const RECENT_SAVE_DEBOUNCE_MS = 250;

const PALETTE = [
  '#E24B4A', '#BA7517', '#639922', '#0F6E56', '#185FA5',
  '#7F77DD', '#D4537E', '#2C2C2A', '#FFFFFF',
];

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else              [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  };
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function loadList(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function saveList(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
}

export function createColorPicker(containerEl, { initialColor = '#ffffff', onChange = () => {}, onCommit = () => {} } = {}) {
  containerEl.innerHTML = '';
  containerEl.classList.add('vk-colorpicker');

  const rgb0 = hexToRgb(initialColor);
  let { h, s, v } = rgbToHsv(rgb0.r, rgb0.g, rgb0.b);
  let currentHex = initialColor;
  let recentSaveTimer = null;

  // ── Trigger swatch + popover shell ──────────────────────────────────────
  const swatchBtn = document.createElement('button');
  swatchBtn.type = 'button';
  swatchBtn.className = 'vk-cp-swatch';
  swatchBtn.style.background = currentHex;
  containerEl.appendChild(swatchBtn);

  const popover = document.createElement('div');
  popover.className = 'vk-cp-popover';
  popover.style.display = 'none';
  containerEl.appendChild(popover);

  // ── SV area (gradient overlay + thumb, ported from .sv-area/.sv-gradient) ─
  const svArea = document.createElement('div');
  svArea.className = 'vk-cp-sv';
  const svGradient = document.createElement('div');
  svGradient.className = 'vk-cp-sv-gradient';
  const svThumb = document.createElement('div');
  svThumb.className = 'vk-cp-sv-thumb';
  svArea.appendChild(svGradient);
  svArea.appendChild(svThumb);
  popover.appendChild(svArea);

  // ── Hue — native range input, matches reference ──────────────────────────
  const hueInput = document.createElement('input');
  hueInput.type = 'range';
  hueInput.min = '0'; hueInput.max = '360'; hueInput.step = '1';
  hueInput.className = 'vk-cp-hue';
  popover.appendChild(hueInput);

  // ── Hex input ─────────────────────────────────────────────────────────────
  const hexRow = document.createElement('div');
  hexRow.className = 'vk-cp-hex-row';
  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.className = 'vk-cp-hex-input';
  hexRow.appendChild(hexInput);
  popover.appendChild(hexRow);

  // ── Recent / Palette / Saved rows ────────────────────────────────────────
  function addSection(title) {
    const lbl = document.createElement('div');
    lbl.className = 'vk-cp-section-label';
    lbl.textContent = title;
    popover.appendChild(lbl);
    const row = document.createElement('div');
    row.className = 'vk-cp-swatch-row';
    popover.appendChild(row);
    return row;
  }
  const recentRow  = addSection('Recent');
  const paletteRow = addSection('Palette');
  const savedRow   = addSection('Saved');

  const addCurrentBtn = document.createElement('button');
  addCurrentBtn.type = 'button';
  addCurrentBtn.className = 'vk-cp-add-btn';
  addCurrentBtn.textContent = '+ Add Current';
  popover.appendChild(addCurrentBtn);

  function makeSwatch(hex, onClick) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'vk-cp-color-swatch';
    sw.style.background = hex;
    sw.title = hex;
    sw.addEventListener('click', onClick);
    return sw;
  }

  function renderRecent() {
    recentRow.innerHTML = '';
    for (const hex of loadList(RECENT_KEY)) recentRow.appendChild(makeSwatch(hex, () => setFromHex(hex, true)));
  }
  function renderSaved() {
    savedRow.innerHTML = '';
    for (const hex of loadList(SAVED_KEY)) savedRow.appendChild(makeSwatch(hex, () => setFromHex(hex, true)));
  }
  function renderPalette() {
    paletteRow.innerHTML = '';
    for (const hex of PALETTE) paletteRow.appendChild(makeSwatch(hex, () => setFromHex(hex, true)));
  }

  function pushRecent(hex) {
    let list = loadList(RECENT_KEY).filter(c => c.toLowerCase() !== hex.toLowerCase());
    list.unshift(hex);
    if (list.length > MAX_RECENT) list.length = MAX_RECENT;
    saveList(RECENT_KEY, list);
    renderRecent();
  }
  function pushSaved(hex) {
    let list = loadList(SAVED_KEY).filter(c => c.toLowerCase() !== hex.toLowerCase());
    list.unshift(hex);
    if (list.length > MAX_SAVED) list.length = MAX_SAVED;
    saveList(SAVED_KEY, list);
    renderSaved();
  }

  // ── Render / emit ─────────────────────────────────────────────────────────
  function updateVisuals() {
    svGradient.style.background =
      `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))`;
    svThumb.style.left = `${s * 100}%`;
    svThumb.style.top  = `${(1 - v) * 100}%`;
    hueInput.value = h;
  }

  function emit(commitToExternal) {
    const rgb = hsvToRgb(h, s, v);
    currentHex = rgbToHex(rgb.r, rgb.g, rgb.b);
    swatchBtn.style.background = currentHex;
    hexInput.value = currentHex;
    updateVisuals();
    onChange(currentHex);

    // Ambient recent-history bookkeeping — debounced like the reference,
    // independent of whether this particular emit is an external commit.
    clearTimeout(recentSaveTimer);
    recentSaveTimer = setTimeout(() => pushRecent(currentHex), RECENT_SAVE_DEBOUNCE_MS);

    if (commitToExternal) onCommit(currentHex);
  }

  function setFromHex(hex, commit) {
    const rgb = hexToRgb(hex);
    ({ h, s, v } = rgbToHsv(rgb.r, rgb.g, rgb.b));
    emit(commit);
  }

  // ── SV drag — pointer capture, ported from reference ─────────────────────
  function setSV(clientX, clientY) {
    const r = svArea.getBoundingClientRect();
    s = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    v = Math.min(1, Math.max(0, 1 - (clientY - r.top) / r.height));
    emit(false);
  }
  svArea.addEventListener('pointerdown', (e) => {
    svArea.setPointerCapture(e.pointerId);
    setSV(e.clientX, e.clientY);
  });
  svArea.addEventListener('pointermove', (e) => { if (e.buttons) setSV(e.clientX, e.clientY); });
  svArea.addEventListener('pointerup', () => emit(true)); // commit on release — required by §6's wiring

  hueInput.addEventListener('input',  () => { h = parseFloat(hueInput.value); emit(false); });
  hueInput.addEventListener('change', () => emit(true)); // native range fires 'change' on release

  hexInput.addEventListener('change', () => {
    const val = hexInput.value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(val)) setFromHex(val.startsWith('#') ? val : `#${val}`, true);
    else hexInput.value = currentHex;
  });

  addCurrentBtn.addEventListener('click', () => pushSaved(currentHex));

  swatchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = popover.style.display !== 'none';
    document.querySelectorAll('.vk-cp-popover').forEach(p => { p.style.display = 'none'; });
    popover.style.display = open ? 'none' : 'block';
  });
  document.addEventListener('click', (e) => {
    if (!containerEl.contains(e.target)) popover.style.display = 'none';
  });

  renderRecent();
  renderPalette();
  renderSaved();
  emit(false); // initial paint, no external commit

  return {
    setColor: hex => setFromHex(hex, false),
    getColor: () => currentHex,
    destroy: () => { containerEl.innerHTML = ''; },
  };
}