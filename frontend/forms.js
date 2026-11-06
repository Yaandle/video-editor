// forms.js — schema-driven fields for the inspector, project settings and Text
// Studio. A schema is the registry's prop schema ({ type, default, label, min,
// max, step, options, multiline, of }); every field reads a value and calls
// onChange(value, { final }) — `final` is false while a slider/typing is live
// and true on commit, so callers can coalesce undo steps.

import { paletteNames, color as tokenColor } from './renderer/tokens.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid);
  return e;
};
export { el };

function labelRow(text, extra = null) {
  return el('label', {}, el('span', { text }), extra);
}

export function field(key, s, value, onChange, opts = {}) {
  const wrap = el('div', { class: 'field', 'data-key': key });
  const label = s.label ?? key;
  const v = value === undefined ? s.default : value;
  switch (s.type) {
    case 'bool': {
      const input = el('input', { type: 'checkbox' });
      input.checked = !!v;
      input.addEventListener('change', () => onChange(input.checked, { final: true }));
      wrap.append(el('label', { class: 'toggle' }, input, el('span', { text: label })));
      return wrap;
    }
    case 'enum': {
      const optsList = s.options ?? [];
      if (optsList.length <= 4 && optsList.every((o) => String(o).length <= 9) && !opts.selectEnums) {
        const seg = el('div', { class: 'seg' });
        for (const o of optsList) {
          const b = el('button', { type: 'button', class: o === v ? 'on' : null, text: s.optionLabels?.[o] ?? o });
          b.addEventListener('click', () => {
            seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
            onChange(o, { final: true });
          });
          seg.append(b);
        }
        wrap.append(labelRow(label), seg);
      } else {
        const sel = el('select');
        for (const o of optsList) sel.append(el('option', { value: o, text: s.optionLabels?.[o] ?? o }));
        sel.value = v;
        sel.addEventListener('change', () => onChange(sel.value, { final: true }));
        wrap.append(labelRow(label), sel);
      }
      return wrap;
    }
    case 'number': {
      const input = el('input', { type: 'number', min: s.min, max: s.max, step: s.step ?? 'any' });
      input.value = v ?? 0;
      const read = () => {
        let n = parseFloat(input.value);
        if (!Number.isFinite(n)) return null;
        if (s.min !== undefined) n = Math.max(s.min, n);
        if (s.max !== undefined) n = Math.min(s.max, n);
        return n;
      };
      input.addEventListener('input', () => { const n = read(); if (n !== null) onChange(n, { final: false }); });
      input.addEventListener('change', () => { const n = read(); if (n !== null) { input.value = n; onChange(n, { final: true }); } });
      if (s.min !== undefined && s.max !== undefined && s.max - s.min <= 4000 && !opts.noRange) {
        const range = el('input', { type: 'range', min: s.min, max: s.max, step: s.step ?? (s.max - s.min) / 200 });
        range.value = v ?? 0;
        range.addEventListener('input', () => { input.value = range.value; onChange(parseFloat(range.value), { final: false }); });
        range.addEventListener('change', () => onChange(parseFloat(range.value), { final: true }));
        input.addEventListener('change', () => { range.value = input.value; });
        wrap.append(labelRow(label), el('div', { class: 'field-row' }, range, input));
      } else {
        wrap.append(labelRow(label), input);
      }
      return wrap;
    }
    case 'color': {
      const sw = el('div', { class: 'swatches' });
      const hexIn = el('input', { type: 'text', value: String(v ?? ''), spellcheck: 'false', style: 'width:96px' });
      const names = opts.palette ?? paletteNames();
      const mark = (val) => sw.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('on', b.dataset.v === val));
      for (const n of names) {
        const b = el('button', { type: 'button', class: 'swatch', title: n, 'data-v': n, style: `background:${opts.resolve ? opts.resolve(n) : tokenColor(n)}` });
        b.addEventListener('click', () => { hexIn.value = n; mark(n); onChange(n, { final: true }); });
        sw.append(b);
      }
      hexIn.addEventListener('change', () => {
        const t = hexIn.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(t) || names.includes(t)) { mark(t); onChange(t, { final: true }); }
        else hexIn.value = String(v ?? '');
      });
      sw.append(hexIn);
      mark(v);
      wrap.append(labelRow(label), sw);
      return wrap;
    }
    case 'list': {
      const input = el('input', { type: 'text', value: (v ?? []).join(', '), spellcheck: 'false' });
      input.addEventListener('change', () => {
        let items = input.value.split(',').map((x) => x.trim()).filter(Boolean);
        if (s.of === 'number') items = items.map(Number).filter(Number.isFinite);
        if (s.maxItems) items = items.slice(0, s.maxItems);
        onChange(items, { final: true });
      });
      wrap.append(labelRow(label, el('small', { text: 'comma separated' })), input);
      return wrap;
    }
    case 'object': {
      const ta = el('textarea', { rows: 3, spellcheck: 'false' });
      ta.value = JSON.stringify(v ?? {}, null, 1);
      ta.addEventListener('change', () => {
        try { onChange(JSON.parse(ta.value), { final: true }); ta.classList.remove('bad'); } catch { ta.classList.add('bad'); }
      });
      wrap.append(labelRow(label), ta);
      return wrap;
    }
    case 'asset': {
      const input = el('input', { type: 'text', value: v ?? '', spellcheck: 'false', list: opts.assetList ?? null });
      input.addEventListener('change', () => onChange(input.value.trim(), { final: true }));
      wrap.append(labelRow(label), input);
      return wrap;
    }
    default: {
      const multi = s.multiline;
      const input = multi ? el('textarea', { rows: Math.min(8, Math.max(2, String(v ?? '').split('\n').length + 1)), spellcheck: 'true' })
        : el('input', { type: 'text', spellcheck: 'true', maxlength: s.maxLength });
      input.value = v ?? '';
      input.addEventListener('input', () => onChange(input.value, { final: false }));
      input.addEventListener('change', () => onChange(input.value, { final: true }));
      wrap.append(labelRow(label, s.maxLength ? el('small', { text: `≤ ${s.maxLength}` }) : null), input);
      return wrap;
    }
  }
}

const ICONS = new Map();
function icon(name) {
  if (!ICONS.has(name)) ICONS.set(name, fetch(`/assets/icons/phosphor-bold/${name}.svg`).then((r) => (r.ok ? r.text() : '')).catch(() => ''));
  return ICONS.get(name);
}
/** Inline the Phosphor SVG named by data-icon into every element under root (once). */
export async function decorateIcons(root = document) {
  await Promise.all([...root.querySelectorAll('[data-icon]:not([data-icon-done])')].map(async (b) => {
    const svg = await icon(b.dataset.icon);
    if (!svg) return;
    b.dataset.iconDone = '1';
    b.insertAdjacentHTML('afterbegin', svg.replace('<svg', '<svg aria-hidden="true"'));
  }));
}

/** A collapsible inspector section. */
export function section(title, open, ...rows) {
  const d = el('details', { class: 'section', open: open || null });
  d.append(el('summary', { text: title }), el('div', { class: 'rows' }, ...rows));
  return d;
}

/** Fields for every key of a schema; `values` is the current object, `onChange(key, value, meta)`. */
export function schemaFields(schema, values, onChange, opts = {}) {
  return Object.entries(schema)
    .filter(([k]) => !(opts.skip ?? []).includes(k))
    .map(([k, s]) => field(k, s, values?.[k], (v, meta) => onChange(k, v, meta), opts));
}
