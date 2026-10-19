// Neo-brutal scene templates. Each is a full-frame composition on the 12-column
// grid with one focal point, a reading order, a deliberate grid break, beat-
// landed entrances, ambient hold motion and a fast exit into the cut.
// Copy and images are props, so every scene is reusable as a template.

import { register } from '../registry.js';
import { color, border, shadow as shadowTok, type as typeRole, onColor } from '../tokens.js';
import { box, frame as frameRect, hatch, dots, sticker as drawSticker, imageCover, arrow as drawArrow, ticker as drawTicker, rule } from '../draw.js';
import { sp, fade, lerp, spring, params, settle, peak, staggerStep } from '../motion.js';
import { textBlock, gridLines, reportBox, tint } from '../kit.js';
import { clock, exitP, landingEvents } from './helpers.js';

const EXIT = { to: 'mask', preset: 'quick', length: 0.32 };

function setFont(ctx, r) {
  ctx.font = r.font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${r.tracking * r.size}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}

function bg(ctx, env, fill) {
  ctx.fillStyle = color(fill);
  ctx.fillRect(0, 0, env.frame.w, env.frame.h);
  gridLines(ctx, env, fill);
}

/** Text whose lines land on beats n0, n0+1, … */
function beatLines(c, clip, n0) {
  const l = c.land(n0, 'slam');
  return { unit: 'line', from: 'mask', preset: 'slam', stagger: c.beat, delay: l.start - clip.start };
}

// ── 1. Title slam ─────────────────────────────────────────────────────────────
register({
  type: 'scene.title-slam',
  kind: 'scene',
  label: 'Title slam',
  category: 'Scenes',
  description: 'Hero headline that slams in line by line over a bleeding colour block, with a spinning sticker and a short deck.',
  duration: 4,
  schema: {
    kicker: { type: 'text', default: 'Studio build 2.0', label: 'Kicker (≤ 3 words)', maxLength: 32 },
    headline: { type: 'text', default: 'Motion that\nkeeps [[time.]]', label: 'Headline (2 lines)', multiline: true, maxLength: 60 },
    deck: { type: 'text', default: 'A browser editor where every frame is a pure function of time, previewed and exported by the same renderer.', label: 'Deck', multiline: true, maxLength: 200 },
    sticker: { type: 'text', default: 'NEW BUILD · 2.0 · NEW BUILD · 2.0 · ', label: 'Sticker ring', maxLength: 60 },
    block: { type: 'color', default: 'orange', label: 'Block colour' },
    background: { type: 'color', default: 'paper', label: 'Background' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u, F = env.frame, g = env.grid;
    const c = clock(clip, env);
    bg(ctx, env, p.background);
    const ex = exitP(env, clip);

    // Block: lands on beat 1, bleeds off the right edge (grid break #1).
    const lb = c.land(1, 'slam');
    const e = env.t - lb.start;
    if (e > 0) {
      const bx0 = g.colX(7), by = 236 * u, bh = 560 * u, bw = F.w - bx0 + 80 * u;
      const bx = bx0 + (F.w - bx0 + 120 * u) * (1 - sp(e, 'slam')) + (F.w * 0.7) * ex;
      box(ctx, bx, by, bw, bh, { fill: color(p.block), shadow: shadowTok(F, 'video-lg') });
      hatch(ctx, bx, by + bh - 132 * u, bw, 132 * u, { color: color('ink'), gap: 22 * u, width: 4 * u });
      frameRect(ctx, bx, by, bw, bh, border(F), color('ink'));
      reportBox(env, { name: 'block', x: bx, y: by, w: bw, h: bh, bleed: true, gridBreak: true, settled: e > settle('slam') && !ex });
    }

    textBlock(ctx, env, {
      name: 'kicker', text: p.kicker, role: 'label', case: 'upper', x: g.margin, y: 196 * u, color: 'ink',
      bg: p.background, lt, duration: clip.duration,
      enter: { unit: 'char', from: 'rise', preset: 'snappy', delay: 0.04 }, exit: { to: 'fade', length: 0.32 },
    });
    textBlock(ctx, env, {
      name: 'headline', text: p.headline, role: 'hero', x: g.margin, y: 296 * u, maxWidth: g.span(0, 12).w,
      color: 'ink', highlight: 'lime', bg: p.background, lt: env.t - clip.start, duration: clip.duration,
      enter: beatLines(c, clip, 2), exit: EXIT,
    });
    const deckStart = c.B(4.5) - clip.start;
    textBlock(ctx, env, {
      name: 'deck', text: p.deck, role: 'body', x: g.margin, y: 776 * u, maxWidth: g.span(0, 6).w,
      color: 'ink', bg: p.background, lt, duration: clip.duration,
      enter: { unit: 'line', from: 'rise', preset: 'soft', delay: deckStart }, exit: { to: 'fade', length: 0.32 },
    });

    // Sticker lands on beat 4 across the block's bottom edge (grid break #2).
    const ls = c.land(4, 'wobble', 'scale');
    const es = env.t - ls.start;
    if (es > 0) {
      const r = 132 * u;
      const cx = 1666 * (F.w / 1920), cy = 806 * u;
      const s = Math.max(0, sp(es, 'wobble', 'scale')) * (1 - ex);
      const lab = typeRole('label', F, { font: 'mono-bold', weight: 700 });
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      drawSticker(ctx, 0, 0, r, {
        fill: color('lime'), ink: color('ink'), strokeW: border(F), points: 18, shadow: shadowTok(F),
        rotation: ((-12 - 40 * (1 - sp(es, 'wobble', 'rotation'))) * Math.PI) / 180,
        text: p.sticker, font: `700 ${Math.round(r * 0.17)}px "${lab.family}"`,
        textRotation: (26 * lt * Math.PI) / 180, center: true,
      });
      ctx.restore();
      reportBox(env, { name: 'sticker', x: cx - r, y: cy - r, w: r * 2, h: r * 2, gridBreak: true, settled: es > settle('wobble', 'rotation') });
    }
    env.animating();
  },
  events(clip, env) {
    const c = clock(clip, env);
    const lines = String(env.props.headline).split('\n').length;
    return landingEvents([
      { ...c.land(1, 'slam'), role: 'block', sound: 'impact', gain_db: -4 },
      ...Array.from({ length: lines }, (_, i) => ({ ...c.land(2 + i, 'slam'), role: 'headline', sound: i ? 'pop' : 'impact', gain_db: i ? -7 : -5 })),
      { ...c.land(4, 'wobble', 'scale'), role: 'sticker', sound: 'pop', gain_db: -6 },
    ]).concat([{ kind: 'cue', t: c.B(4.5), sound: 'whoosh', gain_db: -16 }]);
  },
});

// ── 2. Beat grid ──────────────────────────────────────────────────────────────
register({
  type: 'scene.beat-grid',
  kind: 'scene',
  label: 'Beat grid',
  category: 'Scenes',
  description: 'Dark scene: a statement over eight steps that light up one per beat while a playhead sweeps across.',
  duration: 4,
  schema: {
    kicker: { type: 'text', default: 'Beat grid', label: 'Kicker', maxLength: 32 },
    headline: { type: 'text', default: 'Every cut lands\non the [[beat.]]', label: 'Headline', multiline: true, maxLength: 60 },
    background: { type: 'color', default: 'ink', label: 'Background' },
    lit: { type: 'color', default: 'lime', label: 'Lit step' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u, F = env.frame, g = env.grid;
    const c = clock(clip, env);
    bg(ctx, env, p.background);
    const ink = onColor(p.background);
    textBlock(ctx, env, {
      name: 'kicker', text: p.kicker, role: 'label', case: 'upper', x: g.margin, y: 180 * u, color: 'lime', bg: p.background,
      lt, duration: clip.duration, enter: { unit: 'char', from: 'rise', preset: 'snappy' }, exit: { to: 'fade', length: 0.3 },
    });
    textBlock(ctx, env, {
      name: 'headline', text: p.headline, role: 'display', x: g.margin, y: 236 * u, maxWidth: g.span(0, 10).w,
      color: ink, highlight: 'lime', bg: p.background, lt, duration: clip.duration, enter: beatLines(c, clip, 1), exit: EXIT,
    });

    const n = 8, gap = g.gutter;
    const row = g.span(0, g.columns);
    const sq = (row.w - gap * (n - 1)) / n;
    const y0 = 596 * u;
    const bw = border(F);
    const lab = typeRole('label', F, { font: 'mono-bold', weight: 700 });
    const fps = env.settings.fps;
    // Playhead: a lime rule sweeping the row at exactly one step per beat.
    const sweep = Math.max(0, Math.min(n, (env.t - c.B(0)) / c.beat));
    for (let k = 0; k < n; k++) {
      const appear = env.t - (clip.start + k * 0.035);
      if (appear <= 0) continue;
      const x = row.x + k * (sq + gap);
      const drop = exitP(env, clip, 0.34, k * 0.012);
      const y = y0 + 90 * u * (1 - sp(appear, 'snappy')) + F.h * drop;
      const hitT = c.B(k);
      const lit = env.t >= hitT - 1e-9;
      const press = lit ? Math.max(0, sp(env.t - hitT, 'snappy') - sp(env.t - hitT - 0.12, 'snappy')) : 0;
      const sh = shadowTok(F);
      if (lit) {
        box(ctx, x + sh.x * press, y + sh.y * press, sq, sq, { fill: color(p.lit), stroke: color('ink'), strokeW: bw, shadow: { x: sh.x * (1 - press), y: sh.y * (1 - press), color: color('paper') } });
      } else {
        box(ctx, x, y, sq, sq, { fill: color(p.background), stroke: color('paper'), strokeW: bw });
        dots(ctx, x + bw, y + bw, sq - bw * 2, sq - bw * 2, { color: tint(p.background, 'paper', 0.22), gap: 26 * u, r: 2.5 * u });
      }
      setFont(ctx, lab);
      ctx.fillStyle = lit ? color('ink') : color('paper');
      ctx.fillText(String(k + 1).padStart(2, '0'), x + sh.x * press + 18 * u, y + sh.y * press + 18 * u + lab.size * 0.75);
      reportBox(env, { name: `step${k}`, x, y, w: sq, h: sq, settled: appear > settle('snappy') && !drop });
    }
    if (sweep > 0 && sweep < n) {
      const px = row.x + sweep * (sq + gap) - gap / 2;
      ctx.fillStyle = color('lime');
      ctx.fillRect(px - 3 * u, y0 - 28 * u, 6 * u, sq + 56 * u);
    }
    // Live readout — frame number changes every frame.
    const frameNo = Math.round(env.t * fps);
    const fpb = Math.round(c.beat * fps);
    const bpm = env.settings.bpm ?? 120;
    const readout = [`${bpm} BPM`, `${fpb} frames / beat`, `Frame ${String(frameNo).padStart(4, '0')}`];
    readout.forEach((s, i) => {
      textBlock(ctx, env, {
        name: `readout${i}`, text: s, role: 'label', case: 'upper', x: g.colX(i * 4), y: 856 * u, color: ink, bg: p.background,
        lt: lt - 0.25, duration: clip.duration - 0.25, enter: { unit: 'block', from: 'rise', preset: 'snappy', delay: i * 0.08 }, exit: { to: 'fade', length: 0.3 },
      });
    });
    env.animating();
  },
  events(clip, env) {
    const c = clock(clip, env);
    const lines = String(env.props.headline).split('\n').length;
    const out = landingEvents(Array.from({ length: lines }, (_, i) => ({ ...c.land(1 + i, 'slam'), role: 'headline', sound: i ? 'pop' : 'impact', gain_db: -6 })));
    for (let k = 0; k < 8; k++) out.push({ kind: 'hit', t: c.B(k), sound: 'tick', gain_db: -9, pitch: k });
    return out;
  },
});

// ── 3. Spring lab ─────────────────────────────────────────────────────────────
const LAB_PRESETS = ['snappy', 'slam', 'soft'];
const LAB_FILLS = ['lime', 'orange', 'cobalt'];

register({
  type: 'scene.spring-lab',
  kind: 'scene',
  label: 'Spring lab',
  category: 'Scenes',
  description: 'Three cards plot three spring presets live, each block landing on its own beat.',
  duration: 4,
  schema: {
    kicker: { type: 'text', default: 'motion.js', label: 'Kicker', maxLength: 32 },
    headline: { type: 'text', default: 'Springs, not\neasing curves.', label: 'Headline', multiline: true, maxLength: 60 },
    background: { type: 'color', default: 'paper', label: 'Background' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u, F = env.frame, g = env.grid;
    const c = clock(clip, env);
    bg(ctx, env, p.background);
    textBlock(ctx, env, {
      name: 'kicker', text: p.kicker, role: 'label', x: g.margin, y: 176 * u, color: 'ink-soft', bg: p.background,
      lt, duration: clip.duration, enter: { unit: 'char', from: 'rise', preset: 'snappy' }, exit: { to: 'fade', length: 0.3 },
    });
    textBlock(ctx, env, {
      name: 'headline', text: p.headline, role: 'h1', x: g.margin, y: 220 * u, maxWidth: g.span(0, 8).w,
      color: 'ink', bg: p.background, lt, duration: clip.duration, enter: beatLines(c, clip, 1), exit: EXIT,
    });
    const lab = typeRole('label', F);
    const bw = border(F);
    LAB_PRESETS.forEach((preset, i) => {
      const span = g.span(i * 4, 4);
      const appear = env.t - (c.B(0.5) + i * staggerStep('item'));
      if (appear <= 0) return;
      const drop = exitP(env, clip, 0.34, i * 0.03);
      const x = span.x, w = span.w, h = 456 * u;
      const y = 492 * u + 140 * u * (1 - sp(appear, 'snappy')) + F.h * drop;
      ctx.save();
      ctx.globalAlpha *= fade(appear * 1.4, 'snappy');
      box(ctx, x, y, w, h, { fill: color('white'), stroke: color('ink'), strokeW: bw, shadow: shadowTok(F) });
      const pad = 26 * u;
      setFont(ctx, lab);
      ctx.fillStyle = color('ink');
      ctx.fillText(preset.toUpperCase(), x + pad, y + pad + lab.size * 0.78);
      const pr = params(preset);
      const ptxt = `k ${pr.stiffness} · c ${pr.damping}${pr.mass !== 1 ? ` · m ${pr.mass}` : ''}`;
      const pw = ctx.measureText(ptxt).width;
      ctx.fillStyle = color('ink-soft');
      ctx.fillText(ptxt, x + w - pad - pw, y + pad + lab.size * 0.78);
      rule(ctx, x, y + pad * 2 + lab.size, w, bw * 0.6, color('ink'));
      env.box({ kind: 'text', role: 'label', name: `lab${i}`, x: x + pad, y: y + pad, w: w - pad * 2, h: lab.size * 0.78, fg: color('ink'), bg: color('white'), size: lab.size, text: preset, settled: appear > settle('snappy') && !drop });

      // Plot: value vs time over a 0.9 s window, drawn up to "now".
      const L = c.land(3 + i, preset);
      const e = env.t - L.start;
      const px = x + pad, pyTop = y + pad * 2 + lab.size + 34 * u, pW = w - pad * 2, pH = 200 * u;
      const T = 0.9, vMax = 1.25;
      const vy = (v) => pyTop + pH - (v / vMax) * pH;
      ctx.fillStyle = color('paper-deep');
      ctx.fillRect(px, vy(1) - 1.5 * u, pW, 3 * u);                // target
      ctx.fillStyle = color('ink');
      ctx.fillRect(px, pyTop + pH, pW, 3 * u);                       // time axis
      if (e > 0) {
        ctx.strokeStyle = color('ink');
        ctx.lineWidth = 5 * u;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const steps = 90, upTo = Math.min(e, T);
        for (let s = 0; s <= steps; s++) {
          const tau = (upTo * s) / steps;
          const xx = px + (tau / T) * pW, yy = vy(spring(tau, pr));
          s ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
        }
        ctx.stroke();
        const v = spring(upTo, pr);
        box(ctx, px + (upTo / T) * pW - 9 * u, vy(v) - 9 * u, 18 * u, 18 * u, { fill: color(LAB_FILLS[i]), stroke: color('ink'), strokeW: 4 * u });
      }
      // Rail with a block riding the same spring.
      const railY = y + h - 92 * u, railX = x + pad, railW = w - pad * 2;
      ctx.fillStyle = color('ink');
      ctx.fillRect(railX, railY + 30 * u, railW, 4 * u);
      const target = railX + railW * 0.78;
      ctx.fillRect(target, railY - 8 * u, 4 * u, 80 * u);
      const v = e > 0 ? spring(e, pr) : 0;
      const bs = 60 * u;
      const bx = railX + (target - railX - bs) * v;
      box(ctx, bx, railY, bs, bs, { fill: color(LAB_FILLS[i]), stroke: color('ink'), strokeW: 5 * u, shadow: { x: 7 * u, y: 7 * u, color: color('ink') } });
      ctx.restore();
    });
    env.animating();
  },
  events(clip, env) {
    const c = clock(clip, env);
    return landingEvents([
      { ...c.land(1, 'slam'), role: 'headline', sound: 'impact', gain_db: -6 },
      { ...c.land(2, 'slam'), role: 'headline', sound: 'pop', gain_db: -8 },
      ...LAB_PRESETS.map((pr, i) => ({ ...c.land(3 + i, pr), role: `lab-${pr}`, sound: pr === 'slam' ? 'impact' : 'pop', gain_db: -6 })),
    ]).concat([{ kind: 'cue', t: c.B(0.5), sound: 'whoosh', gain_db: -14 }]);
  },
});

// ── 4. Editorial spread ───────────────────────────────────────────────────────
register({
  type: 'scene.editorial',
  kind: 'scene',
  label: 'Editorial spread',
  category: 'Scenes',
  description: 'Magazine layout: bleeding photo on the right, stacked headline, two text columns and a pull quote across the photo edge.',
  duration: 4,
  schema: {
    kicker: { type: 'text', default: 'Issue 04', label: 'Kicker', maxLength: 32 },
    headline: { type: 'text', default: 'Set type\nlike a\n{{magazine.}}', label: 'Headline', multiline: true, maxLength: 60 },
    col1: { type: 'text', default: 'Twelve columns, an eight-pixel baseline and one rule broken on purpose.', label: 'Column 1', multiline: true, maxLength: 220 },
    col2: { type: 'text', default: 'Kickers, folios and credits come from the same tokens the editor uses.', label: 'Column 2', multiline: true, maxLength: 220 },
    quote: { type: 'text', default: 'One grid.\n[[Broken once.]]', label: 'Pull quote', multiline: true, maxLength: 60 },
    image: { type: 'asset', default: 'assets/images/barbican-02.jpg', label: 'Photo' },
    credit: { type: 'text', default: 'Photo: Daniel Case, CC BY-SA 3.0', label: 'Photo credit', maxLength: 80 },
    focus_y: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.32, label: 'Photo focus Y' },
    background: { type: 'color', default: 'paper', label: 'Background' },
  },
  assets: (clip, props) => [props?.image].filter(Boolean),
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u, F = env.frame, g = env.grid;
    const c = clock(clip, env);
    bg(ctx, env, p.background);
    const ex = exitP(env, clip, 0.34);
    // Photo: soft rise from the cut, slow push-in through the hold.
    const ep = env.t - c.B(0);
    const px = g.colX(6), pw = F.w - px + 40 * u, py = -20 * u, ph = F.h - 64 * u + 20 * u;
    const pyy = py + F.h * 0.55 * (1 - sp(ep, 'soft')) + F.h * ex;
    imageCover(ctx, env.image(p.image), px, pyy, pw, ph, { focusX: 0.5, focusY: p.focus_y, zoom: 1.08 + 0.025 * lt });
    frameRect(ctx, px, pyy, pw + 40 * u, ph, border(F), color('ink'));
    reportBox(env, { name: 'photo', x: px, y: pyy, w: pw, h: ph, bleed: true, settled: ep > settle('soft') && !ex });
    // Credit tag on the photo (required attribution, readable: paper on ink).
    const cr = typeRole('label', F);
    setFont(ctx, cr);
    const cw = ctx.measureText(p.credit).width + 28 * u;
    box(ctx, px, pyy + ph - 64 * u - 52 * u, cw, 52 * u, { fill: color('ink') });
    ctx.fillStyle = color('paper');
    ctx.fillText(p.credit, px + 14 * u, pyy + ph - 64 * u - 52 * u + 26 * u + cr.size * 0.36);
    env.box({ kind: 'text', role: 'label', name: 'credit', x: px + 14 * u, y: pyy + ph - 116 * u + 12 * u, w: cw - 28 * u, h: cr.size * 0.78, fg: color('paper'), bg: color('ink'), size: cr.size, text: p.credit, settled: !ex });

    textBlock(ctx, env, {
      name: 'kicker', text: p.kicker, role: 'label', case: 'upper', x: g.margin, y: 176 * u, color: 'ink', bg: p.background,
      lt, duration: clip.duration, enter: { unit: 'char', from: 'rise', preset: 'snappy' }, exit: { to: 'fade', length: 0.3 },
    });
    textBlock(ctx, env, {
      name: 'headline', text: p.headline, role: 'display', x: g.margin, y: 220 * u, maxWidth: g.span(0, 6).w,
      color: 'ink', accent: 'cobalt', bg: p.background, lt, duration: clip.duration, enter: beatLines(c, clip, 1), exit: EXIT,
    });
    const colStart = c.B(4) - clip.start;
    [p.col1, p.col2].forEach((txt, i) => {
      textBlock(ctx, env, {
        name: `col${i + 1}`, text: txt, role: 'body', x: g.colX(i * 3), y: 690 * u, maxWidth: g.span(0, 3).w - 8 * u,
        color: 'ink', bg: p.background, lt, duration: clip.duration,
        enter: { unit: 'line', from: 'rise', preset: 'soft', delay: colStart + i * 0.1 }, exit: { to: 'fade', length: 0.3 },
      });
    });
    // Pull quote box straddles the photo edge (the one deliberate grid break).
    const lq = c.land(5, 'slam');
    const eq = env.t - lq.start;
    if (eq > 0) {
      const qr = typeRole('h2', F);
      // Right of the headline's last line, above the text columns, across the photo edge.
      const qx = g.colX(5) + 44 * u, qw = g.span(5, 3).w + 40 * u;
      const qy = 452 * u - 120 * u * (1 - sp(eq, 'slam')) + F.h * ex;
      const qh = qr.size * 2.2 + 56 * u;
      ctx.save();
      const rot = (-2.5 + 6 * (1 - sp(eq, 'slam', 'rotation'))) * Math.PI / 180;
      ctx.translate(qx + qw / 2, qy + qh / 2); ctx.rotate(rot); ctx.translate(-(qx + qw / 2), -(qy + qh / 2));
      box(ctx, qx, qy, qw, qh, { fill: color('white'), stroke: color('ink'), strokeW: border(F), shadow: shadowTok(F, 'video-lg') });
      textBlock(ctx, env, {
        name: 'quote', text: p.quote, role: 'h2', x: qx + 28 * u, y: qy + 30 * u, maxWidth: qw - 56 * u,
        color: 'ink', highlight: 'lime', bg: 'white', gridBreak: true, lt: 9, duration: 99,
      });
      ctx.restore();
    }
    // Folio
    textBlock(ctx, env, { name: 'folio', text: 'p. 04', role: 'label', x: g.colX(5), y: 176 * u, color: 'ink-soft', bg: p.background, lt, duration: clip.duration, enter: { unit: 'block', from: 'rise', preset: 'snappy', delay: 0.2 }, exit: { to: 'fade', length: 0.3 } });
    env.animating();
  },
  events(clip, env) {
    const c = clock(clip, env);
    const lines = String(env.props.headline).split('\n').length;
    return landingEvents([
      ...Array.from({ length: lines }, (_, i) => ({ ...c.land(1 + i, 'slam'), role: 'headline', sound: i ? 'pop' : 'impact', gain_db: i ? -8 : -6 })),
      { ...c.land(5, 'slam'), role: 'quote', sound: 'impact', gain_db: -6 },
    ]).concat([{ kind: 'cue', t: c.B(0), sound: 'whoosh', gain_db: -10 }]);
  },
});

// ── 5. Render queue (project cards) ───────────────────────────────────────────
register({
  type: 'scene.render-queue',
  kind: 'scene',
  label: 'Render queue',
  category: 'Scenes',
  description: 'Coloured scene with a two-line statement and three project cards that drop in on the beat, plus a tag strip.',
  duration: 4,
  schema: {
    headline: { type: 'text', default: 'Draft a range.\nRender the {{rest.}}', label: 'Headline', multiline: true, maxLength: 60 },
    cards: {
      type: 'list', of: 'object', label: 'Cards', maxItems: 3,
      default: [
        { image: 'assets/images/film-editing-02.jpg', kicker: 'Job 01', title: 'Title slam', meta: 'Range 0.0–4.0 s', tag: 'Cached', fill: 'lime', progress: 1, rate: 0 },
        { image: 'assets/images/letterpress-02.jpg', kicker: 'Job 02', title: 'Editorial', meta: 'Draft · 960×540', tag: 'Draft', fill: 'orange', progress: 0.25, rate: 0.18 },
        { image: 'assets/images/metronome-01.jpg', kicker: 'Job 03', title: 'Final cut', meta: '1080p30 · 24.0 s', tag: 'Queued', fill: 'paper', progress: 0, rate: 0 },
      ],
    },
    tags: { type: 'list', of: 'text', default: ['Chunk cache', '4 workers', 'Resumable', 'ffprobe-checked'], label: 'Tags', maxItems: 6 },
    background: { type: 'color', default: 'cobalt', label: 'Background' },
  },
  assets: (clip, props) => (props?.cards ?? []).map((c) => c.image).filter(Boolean),
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u, F = env.frame, g = env.grid;
    const c = clock(clip, env);
    bg(ctx, env, p.background);
    const ink = onColor(p.background);
    textBlock(ctx, env, {
      name: 'headline', text: p.headline, role: 'h1', x: g.margin, y: 176 * u, maxWidth: g.span(0, 9).w,
      color: ink, accent: 'lime', bg: p.background, lt, duration: clip.duration, enter: beatLines(c, clip, 1), exit: EXIT,
    });
    const lab = typeRole('label', F);
    const ti = typeRole('h2', F, { size: 44 });
    const bw = border(F);
    const tilts = [-3, 2.2, -1.2];
    p.cards.forEach((card, i) => {
      const L = c.land(3 + i, 'slam');
      const e = env.t - L.start;
      if (e <= 0) return;
      const span = g.span(i * 4, 4);
      const w = span.w - 40 * u, imgH = w * 0.5, pad = 24 * u;
      const h = imgH + pad * 2 + lab.size * 1.5 + ti.size * 1.15 + lab.size * 1.4 + 22 * u + pad;
      const drop = exitP(env, clip, 0.34, i * 0.04);
      const x = span.x + 20 * u;
      const y = 404 * u - F.h * 0.8 * (1 - sp(e, 'slam')) + F.h * 1.1 * drop;
      const rot = ((tilts[i] + 10 * (1 - sp(e, 'slam', 'rotation')) * (i % 2 ? -1 : 1)) * Math.PI) / 180;
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rot); ctx.translate(-(x + w / 2), -(y + h / 2));
      box(ctx, x, y, w, h, { fill: color('white'), shadow: shadowTok(F, 'video-lg') });
      imageCover(ctx, env.image(card.image), x, y, w, imgH, { focusY: 0.45 });
      ctx.fillStyle = color('ink');
      ctx.fillRect(x, y + imgH, w, bw);
      let cy = y + imgH + pad;
      setFont(ctx, lab);
      ctx.fillStyle = color('ink-soft');
      ctx.fillText(card.kicker.toUpperCase(), x + pad, cy + lab.size * 0.8);
      cy += lab.size * 1.5;
      setFont(ctx, ti);
      ctx.fillStyle = color('ink');
      ctx.fillText(card.title, x + pad, cy + ti.size * 0.76);
      cy += ti.size * 1.15;
      setFont(ctx, lab);
      ctx.fillText(card.meta, x + pad, cy + lab.size * 0.8);
      cy += lab.size * 1.4;
      const prog = Math.min(1, (card.progress ?? 0) + (card.rate ?? 0) * Math.max(0, e));
      frameRect(ctx, x + pad, cy, w - pad * 2, 22 * u, 4 * u, color('ink'));
      ctx.fillStyle = color('cobalt');
      ctx.fillRect(x + pad + 4 * u, cy + 4 * u, Math.max(0, (w - pad * 2 - 8 * u) * prog), 14 * u);
      frameRect(ctx, x, y, w, h, bw, color('ink'));
      // Status tag hangs over the card's top edge — drawn last so the border never cuts it.
      const tl = card.tag.toUpperCase();
      const tw = ctx.measureText(tl).width + lab.size * 1.4, th = lab.size * 2;
      box(ctx, x + w - tw * 0.8, y - th * 0.55, tw, th, { fill: color(card.fill), stroke: color('ink'), strokeW: bw * 0.7 });
      ctx.fillStyle = onColor(card.fill);
      ctx.fillText(tl, x + w - tw * 0.8 + lab.size * 0.7, y - th * 0.55 + th / 2 + lab.size * 0.36);
      ctx.restore();
      const settled = e > settle('slam') && !drop;
      reportBox(env, { name: `card${i}`, x, y, w, h, settled, gridBreak: true });
      env.box({ kind: 'text', role: 'h2', name: `card${i}-title`, x: x + pad, y: y + imgH + pad + lab.size * 1.5, w: w - pad * 2, h: ti.size * 0.76, fg: color('ink'), bg: color('white'), size: ti.size, text: card.title, settled });
    });
    // Tag strip along the bottom.
    const tagStart = c.B(6);
    setFont(ctx, lab);
    let tx = g.margin;
    p.tags.forEach((tag, i) => {
      const e = env.t - tagStart - i * 0.07;
      const label = tag.toUpperCase();
      const w = ctx.measureText(label).width + lab.size * 1.6, h = lab.size * 2.1;
      if (e > 0) {
        const drop = exitP(env, clip, 0.3);
        const yy = 934 * u + 50 * u * (1 - sp(e, 'snappy')) + F.h * drop;
        const fill = i < 2 ? 'lime' : 'paper';
        box(ctx, tx, yy, w, h, { fill: color(fill), stroke: color('ink'), strokeW: bw * 0.7, shadow: { x: 7 * u, y: 7 * u, color: color('ink') } });
        setFont(ctx, lab);
        ctx.fillStyle = color('ink');
        ctx.fillText(label, tx + lab.size * 0.8, yy + h / 2 + lab.size * 0.36);
        env.box({ kind: 'text', role: 'label', name: `tag${i}`, x: tx + lab.size * 0.8, y: yy + h * 0.3, w: w - lab.size * 1.6, h: lab.size * 0.78, fg: color('ink'), bg: color(fill), size: lab.size, text: label, settled: e > settle('snappy') });
      }
      tx += w + 20 * u;
    });
    env.animating();
  },
  events(clip, env) {
    const c = clock(clip, env);
    const n = (env.props.cards ?? []).length;
    return landingEvents([
      { ...c.land(1, 'slam'), role: 'headline', sound: 'impact', gain_db: -6 },
      { ...c.land(2, 'slam'), role: 'headline', sound: 'pop', gain_db: -8 },
      ...Array.from({ length: n }, (_, i) => ({ ...c.land(3 + i, 'slam'), role: 'card', sound: 'impact', gain_db: -6 })),
    ]).concat([{ kind: 'cue', t: c.B(6), sound: 'tick', gain_db: -12 }]);
  },
});

// ── 6. Outro / call to action ─────────────────────────────────────────────────
register({
  type: 'scene.outro',
  kind: 'scene',
  label: 'Outro CTA',
  category: 'Scenes',
  description: 'Bright closing card: hero call to action, chunky button and boxed arrow pressing on the beat, a tilted ticker and credits.',
  duration: 4,
  schema: {
    kicker: { type: 'text', default: 'One command', label: 'Kicker', maxLength: 32 },
    headline: { type: 'text', default: 'Open\n{{start.bat}}', label: 'Headline', multiline: true, maxLength: 40 },
    button: { type: 'text', default: 'Launch editor', label: 'Button', maxLength: 28 },
    ticker: { type: 'list', of: 'text', default: ['Beat-locked', 'Spring-animated', 'Rendered offline', 'Synth audio', '1080p'], label: 'Ticker', maxItems: 8 },
    credits: { type: 'text', default: 'Photos: Wikimedia Commons, CC BY / BY-SA. Credits in assets/MANIFEST.json', label: 'Credits', maxLength: 120 },
    background: { type: 'color', default: 'lime', label: 'Background' },
    hold_last: { type: 'bool', default: true, label: 'Hold to the end (no exit)' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u, F = env.frame, g = env.grid;
    const c = clock(clip, env);
    bg(ctx, env, p.background);
    const exit = p.hold_last ? null : EXIT;
    textBlock(ctx, env, {
      name: 'kicker', text: p.kicker, role: 'label', case: 'upper', x: g.margin, y: 176 * u, color: 'ink', bg: p.background,
      lt, duration: clip.duration, enter: { unit: 'char', from: 'rise', preset: 'snappy' }, exit: p.hold_last ? null : { to: 'fade' },
    });
    textBlock(ctx, env, {
      name: 'headline', text: p.headline, role: 'hero', x: g.margin, y: 222 * u, maxWidth: g.span(0, 10).w,
      color: 'ink', accent: 'cobalt', bg: p.background, lt, duration: clip.duration, enter: beatLines(c, clip, 1), exit,
    });
    // Button + boxed arrow land on beats 3 and 4, then press on beats 5 and 6.
    const sh = shadowTok(F);
    const bwid = border(F);
    const press = (tp) => Math.max(0, sp(env.t - tp, 'snappy') - sp(env.t - tp - 0.2, 'snappy'));
    const r2 = typeRole('h2', F);
    const lb = c.land(3, 'slam');
    const eb = env.t - lb.start;
    if (eb > 0) {
      setFont(ctx, r2);
      const tw = ctx.measureText(p.button).width;
      const padX = r2.size * 0.6, padY = r2.size * 0.46;
      const w = tw + padX * 2 + r2.size * 1.1, h = r2.size * 0.74 + padY * 2;
      const d = press(c.B(5));
      const x = g.margin + sh.x * d;
      const y = 700 * u + 160 * u * (1 - sp(eb, 'slam')) + sh.y * d;
      box(ctx, x, y, w, h, { fill: color('ink'), stroke: color('ink'), strokeW: bwid, shadow: { x: sh.x * (1 - d), y: sh.y * (1 - d), color: color('cobalt') } });
      setFont(ctx, r2);
      ctx.fillStyle = color('lime');
      ctx.fillText(p.button, x + padX, y + padY + r2.size * 0.74);
      drawArrow(ctx, x + padX + tw + r2.size * 0.22, y + h / 2 - r2.size * 0.42, r2.size * 0.84, { dir: 'right', color: color('lime') });
      env.box({ kind: 'text', role: 'h2', name: 'button', x: x + padX, y: y + padY, w: tw, h: r2.size * 0.74, fg: color('lime'), bg: color('ink'), size: r2.size, text: p.button, settled: eb > settle('slam') && d < 0.01 });
    }
    const la = c.land(4, 'slam');
    const ea = env.t - la.start;
    if (ea > 0) {
      const s = 196 * u;
      const d = press(c.B(6));
      const ax = g.colX(10) + 20 * u + sh.x * d;
      const ay = 316 * u + sh.y * d;
      const k = Math.max(0, sp(ea, 'slam', 'scale'));
      ctx.save();
      ctx.translate(ax + s / 2, ay + s / 2); ctx.scale(k, k); ctx.rotate((8 * (1 - sp(ea, 'slam', 'rotation')) * Math.PI) / 180); ctx.translate(-(ax + s / 2), -(ay + s / 2));
      box(ctx, ax, ay, s, s, { fill: color('orange'), stroke: color('ink'), strokeW: bwid, shadow: { x: sh.x * (1 - d), y: sh.y * (1 - d), color: color('ink') } });
      drawArrow(ctx, ax + s * 0.18, ay + s * 0.18, s * 0.64, { dir: 'up-right', color: color('ink'), weight: 0.17 });
      ctx.restore();
      reportBox(env, { name: 'arrow', x: ax, y: ay, w: s, h: s, settled: ea > settle('slam') && d < 0.01 });
    }
    // Ticker: tilted band, always moving (grid break).
    const th = 96 * u, ty = 868 * u;
    const grow = Math.min(1, Math.max(0, sp(lt - 0.1, 'snappy', 'scale')));
    if (grow > 0) {
      const tr = typeRole('label', F, { font: 'mono-bold', weight: 700, size: 34 });
      ctx.save();
      ctx.translate(F.w / 2, ty + th / 2); ctx.rotate((-2.2 * Math.PI) / 180); ctx.scale(1, grow); ctx.translate(-F.w / 2, -(ty + th / 2));
      drawTicker(ctx, -60 * u, ty, F.w + 120 * u, th, { items: p.ticker.map((s) => s.toUpperCase()), font: tr.font, tracking: tr.tracking * tr.size, fill: color('ink'), ink: color('paper'), sep: color('lime'), offset: 160 * u * lt, baselineNudge: tr.size * 0.36 });
      frameRect(ctx, -60 * u, ty, F.w + 120 * u, th, bwid, color('ink'));
      ctx.restore();
      env.box({ kind: 'text', role: 'label', name: 'ticker', x: 0, y: ty + th * 0.32, w: F.w, h: tr.size * 0.78, fg: color('paper'), bg: color('ink'), size: tr.size, text: p.ticker.join(' '), bleed: true, gridBreak: true });
    }
    textBlock(ctx, env, {
      name: 'credits', text: p.credits, role: 'label', x: g.colX(6), y: 742 * u, maxWidth: g.span(6, 6).w, color: 'ink', bg: p.background,
      lt, duration: clip.duration, enter: { unit: 'block', from: 'rise', preset: 'snappy', delay: c.B(5.5) - clip.start }, exit: null,
    });
    env.animating();
  },
  events(clip, env) {
    const c = clock(clip, env);
    const lines = String(env.props.headline).split('\n').length;
    return landingEvents([
      ...Array.from({ length: lines }, (_, i) => ({ ...c.land(1 + i, 'slam'), role: 'headline', sound: i ? 'pop' : 'impact', gain_db: -5 })),
      { ...c.land(3, 'slam'), role: 'button', sound: 'pop', gain_db: -7 },
      { ...c.land(4, 'slam'), role: 'arrow', sound: 'impact', gain_db: -6 },
    ]).concat([
      { kind: 'hit', t: c.B(5), sound: 'click', gain_db: -4 },
      { kind: 'hit', t: c.B(6), sound: 'click', gain_db: -4 },
    ]);
  },
});
