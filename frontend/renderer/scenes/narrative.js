// Text-led scene templates. `scene.narrative` is the port of text_to_video's
// narrative_visualiser.html: one active line, the two before it aged out above,
// a 01 / 06 counter, and the h1/h2/body hierarchy heuristic from main.py — but
// timed on the beat grid and drawn deterministically (the original animated
// with CSS keyframes + setTimeout, so its captured frames were not repeatable).

import { register } from '../registry.js';
import { color, border, shadow as shadowTok, type as typeRole, onColor } from '../tokens.js';
import { box, frame as frameRect } from '../draw.js';
import { sp, settle } from '../motion.js';
import { textBlock, gridLines, tint } from '../kit.js';
import { layoutText } from '../text.js';
import { clock, exitP, landingEvents } from './helpers.js';

/** text_to_video main._hierarchy_class, minus the "bold" input we no longer have. */
export function hierarchy(text) {
  const wc = String(text).trim().split(/\s+/).filter(Boolean).length;
  if (wc <= 4) return 'h1';
  if (wc <= 9) return 'h2';
  return 'body';
}

function linesOf(p) {
  return String(p.text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
}

register({
  type: 'scene.narrative',
  kind: 'scene',
  label: 'Narrative lines',
  category: 'Scenes',
  description: 'Reads a script one line at a time: the active line lands on the beat, earlier lines step back above it.',
  duration: 8,
  schema: {
    text: { type: 'text', default: 'Every frame is a function of time.\nNo clocks.\nNo tweens.\nSprings land on the beat.\nThe preview is the export.', label: 'Lines (one per line)', multiline: true, maxLength: 1200 },
    beats_per_line: { type: 'number', min: 1, max: 16, step: 1, default: 2, label: 'Beats per line' },
    background: { type: 'color', default: 'paper', label: 'Background' },
    counter: { type: 'bool', default: true, label: 'Line counter' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u, F = env.frame, g = env.grid;
    const c = clock(clip, env);
    ctx.fillStyle = color(p.background);
    ctx.fillRect(0, 0, F.w, F.h);
    gridLines(ctx, env, p.background);
    const lines = linesOf(p);
    if (!lines.length) return;
    const per = p.beats_per_line * c.beat;
    const idx = Math.max(0, Math.min(lines.length - 1, Math.floor((env.t - clip.start) / per)));
    const ink = onColor(p.background);
    const aged = [tint(p.background, ink, 0.55), tint(p.background, ink, 0.3)];
    const baseY = F.h * 0.58;
    const ex = exitP(env, clip);
    // Earlier lines: stacked above, stepping up as each new line lands.
    for (let age = 2; age >= 1; age--) {
      const i = idx - age;
      if (i < 0) continue;
      const since = env.t - (clip.start + idx * per);
      const k = Math.min(1, sp(since, 'snappy'));
      const r = typeRole('h2', F);
      const lay = layoutText(ctx, { text: lines[i], font: r.font, size: r.size, leading: r.leading, tracking: r.tracking, maxWidth: g.span(0, 10).w, align: 'left' });
      const yFrom = baseY - (age - 1) * (lay.height + 40 * u) - 40 * u;
      const yTo = baseY - age * (lay.height + 40 * u) - 40 * u;
      textBlock(ctx, env, {
        name: `aged${age}`, text: lines[i], role: 'h2', x: g.margin, y: yFrom + (yTo - yFrom) * k - F.h * ex,
        maxWidth: g.span(0, 10).w, color: aged[age - 1], bg: p.background, lt: 9, duration: 99,
      });
    }
    const role = hierarchy(lines[idx]);
    const L = c.land(idx * p.beats_per_line, 'slam');
    textBlock(ctx, env, {
      name: 'active', text: lines[idx], role: role === 'h1' ? 'display' : role, x: g.margin, y: baseY, maxWidth: g.span(0, 10).w,
      color: ink, bg: p.background, lt: env.t - L.start, duration: clip.duration - (L.start - clip.start),
      enter: { unit: role === 'body' ? 'line' : 'word', from: 'mask', preset: 'slam', stagger: role === 'body' ? 0.11 : 0.055 },
      exit: { to: 'mask', length: 0.3 },
    });
    if (p.counter) {
      const fmt = (n) => String(n).padStart(2, '0');
      textBlock(ctx, env, { name: 'counter', text: `${fmt(idx + 1)} / ${fmt(lines.length)}`, role: 'label', x: g.margin, y: F.h - 140 * u, color: ink, bg: p.background, lt: 9, duration: 99 });
    }
    env.animating();
  },
  events(clip, env) {
    const c = clock(clip, env);
    const lines = linesOf(env.props);
    const per = env.props.beats_per_line;
    return landingEvents(lines.map((_, i) => ({ ...c.land(i * per, 'slam'), role: 'line', sound: i === 0 ? 'impact' : 'pop', gain_db: -8 }))
      .filter((l) => l.start >= clip.start - 1e-6 && l.hit < clip.start + clip.duration));
  },
});

register({
  type: 'scene.statement',
  kind: 'scene',
  label: 'Statement',
  category: 'Scenes',
  description: 'Kicker, a big left-aligned statement landing line by line, and a short supporting deck.',
  duration: 4,
  schema: {
    kicker: { type: 'text', default: 'Chapter 01', label: 'Kicker', maxLength: 32 },
    headline: { type: 'text', default: 'Nothing animates\nfor the sake of it.', label: 'Statement', multiline: true, maxLength: 80 },
    deck: { type: 'text', default: 'Every move has an entrance, a hold and an exit.', label: 'Deck', multiline: true, maxLength: 200 },
    background: { type: 'color', default: 'paper', label: 'Background' },
    size: { type: 'enum', options: ['hero', 'display', 'h1'], default: 'display', label: 'Statement size' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u, F = env.frame, g = env.grid;
    const c = clock(clip, env);
    ctx.fillStyle = color(p.background);
    ctx.fillRect(0, 0, F.w, F.h);
    gridLines(ctx, env, p.background);
    const ink = onColor(p.background);
    const l1 = c.land(1, 'slam');
    textBlock(ctx, env, { name: 'kicker', text: p.kicker, role: 'label', case: 'upper', x: g.margin, y: 196 * u, color: ink, bg: p.background, lt, duration: clip.duration, enter: { unit: 'char', from: 'rise', preset: 'snappy' }, exit: { to: 'fade', length: 0.3 } });
    const r = textBlock(ctx, env, {
      name: 'headline', text: p.headline, role: p.size, x: g.margin, y: 260 * u, maxWidth: g.span(0, 11).w, color: ink, highlight: 'lime', accent: 'orange',
      bg: p.background, lt, duration: clip.duration, enter: { unit: 'line', from: 'mask', preset: 'slam', stagger: c.beat, delay: l1.start - clip.start }, exit: { to: 'mask', length: 0.32 },
    });
    textBlock(ctx, env, {
      name: 'deck', text: p.deck, role: 'body', x: g.colX(Math.max(0, g.columns - 5)), y: Math.min(F.h - 260 * u, 260 * u + r.box.h + 72 * u), maxWidth: g.span(0, 5).w,
      color: ink, bg: p.background, lt, duration: clip.duration, enter: { unit: 'line', from: 'rise', preset: 'soft', delay: c.B(3.5) - clip.start }, exit: { to: 'fade', length: 0.3 },
    });
    env.animating();
  },
  events(clip, env) {
    const c = clock(clip, env);
    const n = String(env.props.headline).split('\n').length;
    return landingEvents(Array.from({ length: n }, (_, i) => ({ ...c.land(1 + i, 'slam'), role: 'headline', sound: i ? 'pop' : 'impact', gain_db: -6 })));
  },
});

register({
  type: 'scene.screenshot',
  kind: 'scene',
  label: 'Screenshot feature',
  category: 'Scenes',
  description: 'Kicker, headline and deck on the left; a framed screenshot slams in from the right (stacked below the text in portrait).',
  duration: 4,
  schema: {
    kicker: { type: 'text', default: '01 — Feature', label: 'Kicker', maxLength: 32 },
    headline: { type: 'text', default: 'Say what it\n[[does.]]', label: 'Headline', multiline: true, maxLength: 60 },
    deck: { type: 'text', default: 'One supporting sentence.', label: 'Deck', multiline: true, maxLength: 160 },
    image: { type: 'asset', default: 'assets/images/film-editing-02.jpg', label: 'Screenshot' },
    background: { type: 'color', default: 'paper', label: 'Background' },
  },
  assets: (clip, props) => [props?.image].filter(Boolean),
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u, F = env.frame, g = env.grid;
    const c = clock(clip, env);
    ctx.fillStyle = color(p.background);
    ctx.fillRect(0, 0, F.w, F.h);
    gridLines(ctx, env, p.background);
    const ink = onColor(p.background);
    const P = F.h > F.w;
    const ex = exitP(env, clip);
    const l1 = c.land(1, 'slam');
    textBlock(ctx, env, { name: 'kicker', text: p.kicker, role: 'label', case: 'upper', x: g.margin, y: (P ? 150 : 196) * u, color: ink, bg: p.background, lt, duration: clip.duration, enter: { unit: 'char', from: 'rise', preset: 'snappy' }, exit: { to: 'fade', length: 0.3 } });
    const r = textBlock(ctx, env, {
      name: 'headline', text: p.headline, role: 'h1', x: g.margin, y: (P ? 200 : 260) * u, maxWidth: P ? g.span(0, 6).w : g.span(0, 5).w, color: ink, highlight: 'lime', accent: 'cobalt',
      bg: p.background, lt, duration: clip.duration, enter: { unit: 'line', from: 'mask', preset: 'slam', stagger: c.beat, delay: l1.start - clip.start }, exit: { to: 'mask', length: 0.32 },
    });
    textBlock(ctx, env, {
      name: 'deck', text: p.deck, role: 'body', x: g.margin, y: Math.min(F.h - 260 * u, (P ? 200 : 260) * u + r.box.h + 56 * u), maxWidth: P ? g.span(0, 6).w : g.span(0, 4).w,
      color: ink, bg: p.background, lt, duration: clip.duration, enter: { unit: 'line', from: 'rise', preset: 'soft', delay: c.B(3.5) - clip.start }, exit: { to: 'fade', length: 0.3 },
    });
    // Screenshot: framed, hard shadow, slams in from the right on beat 2, contained in its slot.
    const img = env.image(p.image);
    const slot = P
      ? { x: g.margin, y: F.h * 0.5, w: F.w - g.margin * 2, h: F.h * 0.38 }
      : { x: g.colX(6), y: 150 * u, w: F.w - g.colX(6) - g.margin, h: F.h - 150 * u - 120 * u };
    const L = c.land(2, 'slam');
    const k = Math.max(0, sp(env.t - L.start, 'slam'));
    if (img && k > 0) {
      const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
      const fit = Math.min(slot.w / sw, slot.h / sh);
      const dw = sw * fit, dh = sh * fit;
      const dx = slot.x + (slot.w - dw) / 2 + (F.w - slot.x) * (1 - k) + F.w * ex, dy = slot.y + (slot.h - dh) / 2;
      box(ctx, dx, dy, dw, dh, { fill: color('paper'), shadow: shadowTok(F, 'video-lg') });
      ctx.drawImage(img, dx, dy, dw, dh);
      frameRect(ctx, dx, dy, dw, dh, border(F), color('ink'));
      env.box({ kind: 'image', role: 'screenshot', name: 'screenshot', x: dx, y: dy, w: dw, h: dh, settled: env.t - L.start > settle('slam') && !ex });
    }
    env.animating();
  },
  events(clip, env) {
    const c = clock(clip, env);
    const n = String(env.props.headline).split('\n').length;
    return landingEvents([
      ...Array.from({ length: n }, (_, i) => ({ ...c.land(1 + i, 'slam'), role: 'headline', sound: i ? 'pop' : 'impact', gain_db: -6 })),
      { ...c.land(2, 'slam'), role: 'screenshot', sound: 'impact', gain_db: -5 },
    ]);
  },
});
