// preview.js — the scrubbable player behind every styles/<id>/preview.html and
// the gallery. It renders the pack's demo.json through the same renderer the
// export uses; the transport (wall clock) lives in transport.js, outside the
// motion-linted code. Audio: the mastered preview mix from the studio server.
//
//   <script type="module">import { mountPreview } from '/preview.js'; mountPreview({ pack: 'kinetic' });</script>

import { createRenderer } from './renderer/core.js';
import * as registry from './renderer/registry.js';
import { loadPack } from './renderer/styles.js';
import { Transport } from './transport.js';
import { el, decorateIcons } from './forms.js';

const CSS = `
  body { display: block; overflow: auto; user-select: text; }
  .pv { max-width: 1280px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; }
  .pv header { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
  .pv h1 { font: 400 32px/1 var(--f-display); letter-spacing: -.015em; }
  .pv .desc { max-width: 70ch; color: var(--ink-soft); font: 400 15px/1.45 var(--f-body); }
  .pv .stage { border: var(--bw) solid var(--ink); box-shadow: 8px 8px 0 var(--ink); background: var(--ink); aspect-ratio: 16 / 9; position: relative; }
  .pv canvas { width: 100%; height: 100%; display: block; }
  .pv .bar { display: flex; gap: 8px; align-items: center; }
  .pv .bar input[type=range] { flex: 1; }
  .pv .time { font: 700 13px/1 var(--f-mono); min-width: 150px; text-align: right; }
  .pv .meta { display: flex; gap: 8px; flex-wrap: wrap; }
  .pv a { color: var(--ink); }
  .pv .err { background: var(--orange); border: var(--bw) solid var(--ink); padding: 12px; font: 700 12px/1.4 var(--f-mono); white-space: pre-wrap; }
`;

export async function mountPreview({ pack, demo = `/styles/${pack}/demo.json` }) {
  document.head.append(el('style', { text: CSS }));
  const root = el('div', { class: 'pv' });
  document.body.append(root);
  try {
    const project = await (await fetch(demo)).json();
    const tok = await (await fetch('/design/tokens.json')).json();
    const renderer = await createRenderer({ mode: 'preview', base: '/', tokens: tok });
    await loadPack(pack);
    await renderer.load(project);
    const p = registry.stylePack(pack);
    const s = project.settings;
    document.title = `${p.label} — vidkit style pack`;
    const canvas = el('canvas', { role: 'img', 'aria-label': `${p.label} demo, rendered by the export renderer` });
    const stage = el('div', { class: 'stage', style: `aspect-ratio:${s.width} / ${s.height}` }, canvas);
    const scrub = el('input', { type: 'range', min: 0, max: s.duration, step: 1 / s.fps, value: 0, 'aria-label': 'Scrub' });
    const time = el('span', { class: 'time', text: '0.000 s' });
    const play = el('button', { class: 'btn icon primary', type: 'button', title: 'Play / pause (Space)', 'data-icon': 'play' });
    const prev = el('button', { class: 'btn sm', type: 'button', title: 'Previous frame (,)', text: '‹ frame' });
    const next = el('button', { class: 'btn sm', type: 'button', title: 'Next frame (.)', text: 'frame ›' });
    const sound = el('label', { class: 'toggle' }, el('input', { type: 'checkbox' }), el('span', { text: 'Sound' }));
    root.append(
      el('header', {}, el('a', { href: '/styles/gallery.html', text: '← all style packs' }), el('h1', { text: p.label }), el('span', { class: 'chip', text: pack })),
      el('p', { class: 'desc', text: p.description }),
      stage,
      el('div', { class: 'bar' }, play, prev, next, scrub, time, sound),
      el('div', { class: 'meta' }, ...[`${s.width}×${s.height}`, `${s.fps} fps`, `${s.bpm} BPM`, `${s.duration} s`, `music: ${project.audio?.music?.preset ?? 'none'}`].map((x) => el('span', { class: 'chip', text: x }))),
      el('p', { class: 'desc' }, 'Read the ', el('a', { href: `/styles/${pack}/README.md`, text: 'README' }), ' for how the pack works, its parameters and its limits.'),
    );
    const draw = async (t, exact) => {
      if (exact) await renderer.prepare(t);
      const dpr = devicePixelRatio || 1;
      const w = stage.clientWidth, h = stage.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderer.renderFrame(ctx, Math.min(t, s.duration - 1e-3), { x: 0, y: 0, width: w, height: h });
      scrub.value = t;
      time.textContent = `${t.toFixed(3)} s · f${Math.round(t * s.fps)}`;
    };
    const tr = new Transport((t) => draw(t, false), { loop: true });
    const audioOn = async () => {
      if (!sound.querySelector('input').checked) { tr.audio?.pause(); tr.audio = null; return; }
      const r = await fetch('/api/audio/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project) });
      if (!r.ok) return;
      tr.audio = new Audio(URL.createObjectURL(await r.blob()));
    };
    sound.querySelector('input').addEventListener('change', async () => { const was = tr.playing; tr.pause(); await audioOn(); if (was) tr.play(s.duration); });
    play.addEventListener('click', () => { if (tr.playing) tr.pause(); else tr.play(s.duration); play.classList.toggle('on', tr.playing); });
    const step = (d) => { tr.pause(); tr.seek(Math.max(0, Math.min(s.duration, Math.round((tr.t + d / s.fps) * s.fps) / s.fps))); draw(tr.t, true); };
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    scrub.addEventListener('input', () => { tr.pause(); tr.seek(parseFloat(scrub.value)); draw(tr.t, true); });
    addEventListener('keydown', (e) => {
      if (e.key === ' ') { e.preventDefault(); play.click(); }
      if (e.key === ',') step(-1);
      if (e.key === '.') step(1);
    });
    addEventListener('resize', () => draw(tr.t, false));
    const t0 = Number(new URLSearchParams(location.search).get('t') ?? (p.tokens?.demo?.thumb_t ?? 0));
    tr.seek(t0);
    await draw(t0, true);
    decorateIcons(root);
  } catch (e) {
    root.append(el('div', { class: 'err', text: `Preview failed: ${e.message}\n\nOpen this page through the studio server (start.bat), not from the file system.` }));
  }
}
