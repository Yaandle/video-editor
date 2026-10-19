// Neo-brutal building blocks from the reference board: block, sticker, ticker,
// boxed arrow, button, tag strip, index counter, nav bar, footer bar, card.
// Thick ink borders, 0 radius, hard offset shadows, flat fills. Each element
// enters on a spring, holds with a little ambient motion, and leaves.

import { register, get as getType } from '../registry.js';
import { color, border, shadow as shadowTok, unit, type as typeRole, layoutGrid, onColor } from '../tokens.js';
import { box, frame as frameRect, sticker as drawSticker, ticker as drawTicker, arrow as drawArrow, hatch, dots, imageCover } from '../draw.js';
import { sp, fade, lerp, arrivalFrames, peak, settle, staggerStep } from '../motion.js';
import { textBlock, landing, reportBox } from '../kit.js';

function setFont(ctx, r, tracking = r.tracking) {
  ctx.font = r.font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${tracking * r.size}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}

/** Exit progress for the last `len` seconds of a clip (quick spring, 0 → 1). */
function exitP(lt, duration, len = 0.4, preset = 'quick') {
  const x = lt - (duration - len);
  return x > 0 ? Math.min(1, Math.max(0, sp(x, preset, 'position'))) : 0;
}

/** Scene clips in time order — the nav counter and active link read this. */
function sceneClips(project) {
  return project.clips
    .filter((c) => getType(c.type)?.kind === 'scene')
    .sort((a, b) => a.start - b.start);
}

// ── Block ─────────────────────────────────────────────────────────────────────
register({
  type: 'block',
  kind: 'component',
  label: 'Block',
  category: 'Shapes',
  description: 'A flat bordered panel with hard shadow; optional hatch/dot texture and a mono label.',
  duration: 4,
  schema: {
    w: { type: 'number', min: 4, max: 4000, step: 1, default: 480, label: 'Width px' },
    h: { type: 'number', min: 4, max: 4000, step: 1, default: 320, label: 'Height px' },
    fill: { type: 'color', default: 'orange', label: 'Fill' },
    border: { type: 'bool', default: true, label: 'Border' },
    shadow: { type: 'bool', default: true, label: 'Hard shadow' },
    pattern: { type: 'enum', options: ['none', 'hatch', 'dots'], default: 'none', label: 'Texture' },
    label: { type: 'text', default: '', label: 'Corner label', maxLength: 40 },
    from: { type: 'enum', options: ['none', 'left', 'right', 'rise', 'drop', 'scale'], default: 'right', label: 'Entrance' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u;
    const w = p.w * u * env.xf.sx, h = p.h * u * env.xf.sy;
    let x = env.anchor.x - w / 2, y = env.anchor.y - h / 2;
    const L = landing(clip.start, 'slam', env.beat, env.settings.fps);
    const e = env.t - L.start;
    if (p.from !== 'none' && e <= 0) return;
    const g = p.from === 'none' ? 1 : sp(e, 'slam', 'position');
    const dist = env.frame.w * 0.6;
    if (p.from === 'left') x -= dist * (1 - g);
    if (p.from === 'right') x += dist * (1 - g);
    if (p.from === 'rise') y += env.frame.h * 0.5 * (1 - g);
    if (p.from === 'drop') y -= env.frame.h * 0.5 * (1 - g);
    const ex = exitP(lt, clip.duration);
    x += (p.from === 'left' ? -1 : 1) * dist * ex;
    ctx.save();
    if (p.from === 'scale') {
      const s = Math.max(0, sp(e, 'slam', 'scale'));
      ctx.translate(x + w / 2, y + h / 2); ctx.scale(s, s); ctx.translate(-(x + w / 2), -(y + h / 2));
    }
    box(ctx, x, y, w, h, { fill: color(p.fill), shadow: p.shadow ? shadowTok(env.frame, 'video-lg') : null });
    if (p.pattern === 'hatch') hatch(ctx, x, y, w, h, { color: color('ink'), gap: 22 * u, width: 3 * u });
    if (p.pattern === 'dots') dots(ctx, x, y, w, h, { color: color('ink'), gap: 26 * u, r: 3 * u });
    if (p.border) frameRect(ctx, x, y, w, h, border(env.frame), color('ink'));
    if (p.label) {
      const r = typeRole('label', env.frame);
      setFont(ctx, r);
      ctx.fillStyle = onColor(p.fill);
      ctx.fillText(p.label.toUpperCase(), x + 24 * u, y + 24 * u + r.size * 0.75);
    }
    ctx.restore();
    reportBox(env, { x, y, w, h, bleed: x < 0 || x + w > env.frame.w || y < 0 || y + h > env.frame.h, settled: e > settle('slam') && ex === 0 });
    if (e < settle('slam') || ex > 0) env.animating();
  },
  events(clip, env) {
    if (env.props.from === 'none') return [];
    const L = landing(clip.start, 'slam', env.beat, env.fps);
    return [{ kind: 'hit', t: L.hit, sound: 'impact', gain_db: -6 },
      { kind: 'motion', role: 'block', start: L.start, peak: L.start + peak('slam'), settle: L.start + settle('slam'), preset: 'slam' }];
  },
});

// ── Sticker ───────────────────────────────────────────────────────────────────
register({
  type: 'sticker',
  kind: 'component',
  label: 'Sticker badge',
  category: 'Chrome',
  description: 'Round scalloped badge with text set around a circle; spins slowly, wobbles in.',
  duration: 4,
  schema: {
    text: { type: 'text', default: 'NEW BUILD · 2.0 · NEW BUILD · 2.0 · ', label: 'Ring text', maxLength: 60 },
    fill: { type: 'color', default: 'lime', label: 'Fill' },
    radius: { type: 'number', min: 20, max: 600, step: 1, default: 130, label: 'Radius px' },
    tilt: { type: 'number', min: -180, max: 180, step: 1, default: -12, label: 'Tilt °' },
    spin: { type: 'number', min: -360, max: 360, step: 1, default: 28, label: 'Text spin °/s' },
    points: { type: 'number', min: 0, max: 40, step: 1, default: 18, label: 'Scallops (0 = circle)' },
    delay_beats: { type: 'number', min: 0, max: 64, step: 1, default: 0, label: 'Land on beat #' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u;
    const L = landing(clip.start, 'wobble', env.beat, env.settings.fps, p.delay_beats);
    const e = env.t - L.start;
    if (e <= 0) return;
    const s = Math.max(0, sp(e, 'wobble', 'scale')) * (1 - exitP(lt, clip.duration));
    const rot = ((p.tilt - 38 * (1 - sp(e, 'wobble', 'rotation'))) * Math.PI) / 180;
    const r = p.radius * u * env.xf.sx;
    const lab = typeRole('label', env.frame, { font: 'mono-bold', weight: 700 });
    ctx.save();
    ctx.translate(env.anchor.x, env.anchor.y);
    ctx.scale(s, s);
    drawSticker(ctx, 0, 0, r, {
      fill: color(p.fill), ink: color('ink'), strokeW: border(env.frame), points: p.points,
      shadow: shadowTok(env.frame), rotation: rot,
      text: p.text, font: `700 ${Math.round(r * 0.17)}px "${lab.family}"`,
      textRotation: (p.spin * lt * Math.PI) / 180, center: true,
    });
    ctx.restore();
    reportBox(env, { x: env.anchor.x - r, y: env.anchor.y - r, w: r * 2, h: r * 2, gridBreak: true, settled: e > settle('wobble') });
    env.animating();   // the ring text always turns: never a dead frame
  },
  events(clip, env) {
    const L = landing(clip.start, 'wobble', env.beat, env.fps, env.props.delay_beats);
    return [{ kind: 'hit', t: L.hit, sound: 'pop', gain_db: -6 },
      { kind: 'motion', role: 'sticker', start: L.start, peak: L.start + peak('wobble', 'rotation'), settle: L.start + settle('wobble', 'rotation'), preset: 'wobble' }];
  },
});

// ── Ticker ────────────────────────────────────────────────────────────────────
register({
  type: 'ticker',
  kind: 'component',
  label: 'Ticker strip',
  category: 'Chrome',
  description: 'Full-bleed band of short mono phrases scrolling at constant speed.',
  duration: 4,
  schema: {
    items: { type: 'list', of: 'text', default: ['Beat-locked', 'Spring-animated', 'Rendered offline'], label: 'Items', maxItems: 12 },
    fill: { type: 'color', default: 'ink', label: 'Band' },
    ink: { type: 'color', default: 'paper', label: 'Text' },
    sep: { type: 'color', default: 'lime', label: 'Separator' },
    height: { type: 'number', min: 20, max: 400, step: 1, default: 88, label: 'Height px' },
    speed: { type: 'number', min: -2000, max: 2000, step: 1, default: 150, label: 'Speed px/s' },
    angle: { type: 'number', min: -20, max: 20, step: 0.5, default: 0, label: 'Angle °' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u;
    const h = p.height * u;
    const y = env.anchor.y - h / 2;
    const grow = Math.max(0, Math.min(1, sp(lt, 'snappy', 'scale'))) * (1 - exitP(lt, clip.duration));
    if (grow <= 0) return;
    const r = typeRole('label', env.frame, { font: 'mono-bold', weight: 700, size: (p.height * 0.36) });
    ctx.save();
    ctx.translate(env.frame.w / 2, env.anchor.y);
    ctx.rotate((p.angle * Math.PI) / 180);
    ctx.scale(1, grow);
    ctx.translate(-env.frame.w / 2, -env.anchor.y);
    const over = Math.abs(Math.tan((p.angle * Math.PI) / 180)) * env.frame.w;
    drawTicker(ctx, -over, y, env.frame.w + over * 2, h, {
      items: p.items.map((s) => s.toUpperCase()), font: r.font, tracking: r.tracking * r.size,
      fill: color(p.fill), ink: color(p.ink), sep: color(p.sep), offset: p.speed * lt, baselineNudge: r.size * 0.36,
    });
    frameRect(ctx, -over - 10, y, env.frame.w + over * 2 + 20, h, border(env.frame), color('ink'));
    ctx.restore();
    reportBox(env, { x: 0, y, w: env.frame.w, h, bleed: true });
    env.box({ kind: 'text', role: 'label', x: 0, y: y + h * 0.3, w: env.frame.w, h: r.size, fg: color(p.ink), bg: color(p.fill), size: r.size, text: p.items.join(' '), bleed: true });
    env.animating();
  },
});

// ── Boxed arrow + button (press into their shadow on the beat) ───────────────
function pressDepth(t, pressTimes) {
  let d = 0;
  for (const tp of pressTimes) d += sp(t - tp, 'snappy', 'position') - sp(t - tp - 0.2, 'snappy', 'position');
  return Math.max(0, Math.min(1, d));
}
function pressTimes(clip, p, beat) {
  return (p.press_beats ?? []).map((b) => clip.start + b * (beat?.beat ?? 0.5));
}

register({
  type: 'boxed-arrow',
  kind: 'component',
  label: 'Boxed arrow',
  category: 'Chrome',
  description: 'Square bordered button with a chunky arrow; presses into its shadow on given beats.',
  duration: 4,
  schema: {
    dir: { type: 'enum', options: ['right', 'down', 'left', 'up', 'up-right', 'down-right'], default: 'up-right', label: 'Direction' },
    size: { type: 'number', min: 20, max: 800, step: 1, default: 160, label: 'Size px' },
    fill: { type: 'color', default: 'lime', label: 'Fill' },
    press_beats: { type: 'list', of: 'number', default: [4, 6], label: 'Press on beats', maxItems: 16 },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u;
    const s = p.size * u * env.xf.sx;
    const sh = shadowTok(env.frame);
    const L = landing(clip.start, 'slam', env.beat, env.settings.fps);
    const e = env.t - L.start;
    if (e <= 0) return;
    const g = Math.max(0, sp(e, 'slam', 'scale')) * (1 - exitP(lt, clip.duration));
    const d = pressDepth(env.t, pressTimes(clip, p, env.beat));
    const x = env.anchor.x - s / 2 + sh.x * d, y = env.anchor.y - s / 2 + sh.y * d;
    ctx.save();
    ctx.translate(env.anchor.x, env.anchor.y); ctx.scale(g, g); ctx.translate(-env.anchor.x, -env.anchor.y);
    box(ctx, x, y, s, s, { fill: color(p.fill), stroke: color('ink'), strokeW: border(env.frame), shadow: { ...sh, x: sh.x * (1 - d), y: sh.y * (1 - d) } });
    drawArrow(ctx, x + s * 0.18, y + s * 0.18, s * 0.64, { dir: p.dir, color: color('ink'), weight: 0.17 });
    ctx.restore();
    reportBox(env, { x, y, w: s, h: s, settled: e > settle('slam') });
    if (d > 0 || e < settle('slam')) env.animating();
  },
  events(clip, env) {
    const L = landing(clip.start, 'slam', env.beat, env.fps);
    return [{ kind: 'hit', t: L.hit, sound: 'pop', gain_db: -8 },
      ...pressTimes(clip, env.props, env.beat).map((t) => ({ kind: 'hit', t, sound: 'click', gain_db: -6 }))];
  },
});

register({
  type: 'button',
  kind: 'component',
  label: 'Chunky button',
  category: 'Chrome',
  description: 'Bordered label button with hard shadow that translates into its shadow when pressed.',
  duration: 4,
  schema: {
    label: { type: 'text', default: 'Render range', label: 'Label', maxLength: 32 },
    fill: { type: 'color', default: 'orange', label: 'Fill' },
    icon_arrow: { type: 'bool', default: true, label: 'Trailing arrow' },
    press_beats: { type: 'list', of: 'number', default: [3], label: 'Press on beats', maxItems: 16 },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u;
    const r = typeRole('h2', env.frame);
    setFont(ctx, r);
    const tw = ctx.measureText(p.label).width;
    const padX = r.size * 0.62, padY = r.size * 0.5;
    const aw = p.icon_arrow ? r.size * 1.1 : 0;
    const w = tw + padX * 2 + aw, h = r.size * 0.74 + padY * 2;
    const sh = shadowTok(env.frame);
    const L = landing(clip.start, 'slam', env.beat, env.settings.fps);
    const e = env.t - L.start;
    if (e <= 0) return;
    const g = Math.max(0, sp(e, 'slam', 'scale')) * (1 - exitP(lt, clip.duration));
    const d = pressDepth(env.t, pressTimes(clip, p, env.beat));
    const x = env.anchor.x - w / 2 + sh.x * d, y = env.anchor.y - h / 2 + sh.y * d;
    ctx.save();
    ctx.translate(env.anchor.x, env.anchor.y); ctx.scale(g, g); ctx.translate(-env.anchor.x, -env.anchor.y);
    box(ctx, x, y, w, h, { fill: color(p.fill), stroke: color('ink'), strokeW: border(env.frame), shadow: { ...sh, x: sh.x * (1 - d), y: sh.y * (1 - d) } });
    ctx.fillStyle = onColor(p.fill);
    ctx.fillText(p.label, x + padX, y + padY + r.size * 0.74);
    if (p.icon_arrow) drawArrow(ctx, x + padX + tw + r.size * 0.25, y + h / 2 - r.size * 0.42, r.size * 0.84, { dir: 'right', color: onColor(p.fill) });
    ctx.restore();
    env.box({ kind: 'text', role: 'h2', x: x + padX, y: y + padY, w: tw, h: r.size * 0.74, fg: onColor(p.fill), bg: color(p.fill), size: r.size, text: p.label, settled: e > settle('slam') });
    if (d > 0 || e < settle('slam')) env.animating();
  },
  events(clip, env) {
    const L = landing(clip.start, 'slam', env.beat, env.fps);
    return [{ kind: 'hit', t: L.hit, sound: 'pop', gain_db: -8 },
      ...pressTimes(clip, env.props, env.beat).map((t) => ({ kind: 'hit', t, sound: 'click', gain_db: -5 }))];
  },
});

// ── Tag strip ─────────────────────────────────────────────────────────────────
register({
  type: 'tag-strip',
  kind: 'component',
  label: 'Tag strip',
  category: 'Chrome',
  description: 'A row of bordered mono tags; chosen tags are filled.',
  duration: 4,
  schema: {
    tags: { type: 'list', of: 'text', default: ['Springs', 'Beat grid', 'Offline', '1080p'], label: 'Tags', maxItems: 12 },
    active: { type: 'list', of: 'number', default: [0], label: 'Filled tags (index)', maxItems: 12 },
    fill: { type: 'color', default: 'lime', label: 'Active fill' },
    base: { type: 'color', default: 'paper', label: 'Tag fill' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u;
    const r = typeRole('label', env.frame);
    setFont(ctx, r);
    const bw = border(env.frame) * 0.75;
    const padX = r.size * 0.8, h = r.size * 2.1, gap = 16 * u;
    let x = env.anchor.x;
    const y = env.anchor.y;
    const ex = exitP(lt, clip.duration);
    p.tags.forEach((tag, i) => {
      const label = tag.toUpperCase();
      const w = ctx.measureText(label).width + padX * 2;
      const e = lt - i * staggerStep('item') * 0.6;
      if (e > 0) {
        const g = sp(e, 'snappy', 'position');
        const ox = -60 * u * (1 - g) - env.frame.w * 0.3 * ex;
        const a = fade(e * 1.5, 'snappy');
        ctx.save();
        ctx.globalAlpha *= a;
        const fill = p.active.includes(i) ? p.fill : p.base;
        box(ctx, x + ox, y, w, h, { fill: color(fill), stroke: color('ink'), strokeW: bw, shadow: { ...shadowTok(env.frame), x: 6 * u, y: 6 * u } });
        setFont(ctx, r);
        ctx.fillStyle = onColor(fill);
        ctx.fillText(label, x + ox + padX, y + h / 2 + r.size * 0.36);
        ctx.restore();
        env.box({ kind: 'text', role: 'label', x: x + ox + padX, y: y + h * 0.3, w: w - padX * 2, h: r.size, fg: onColor(fill), bg: color(fill), size: r.size, text: label, settled: e > settle('snappy') && ex === 0 });
      }
      x += w + gap;
    });
    if (lt < 1.2 || ex > 0) env.animating();
  },
  events(clip) { return [{ kind: 'cue', t: clip.start, sound: 'tick', gain_db: -14 }]; },
});

// ── Index counter ─────────────────────────────────────────────────────────────
function rollNumber(ctx, text, prevText, x, y, r, e, ink) {
  // Digits that changed roll up out of a clipped window; unchanged ones stay put.
  const g = Math.min(1, Math.max(0, sp(e, 'snappy', 'position')));
  setFont(ctx, r);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - r.size, y - r.size * 0.05, ctx.measureText(text).width + r.size * 2, r.size * 0.92);
  ctx.clip();
  ctx.fillStyle = ink;
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], pch = prevText?.[i];
    const cw = ctx.measureText(ch).width;
    if (pch !== undefined && pch !== ch && g < 1) {
      ctx.fillText(pch, cx, y + r.size * 0.78 - r.size * g);
      ctx.fillText(ch, cx, y + r.size * 0.78 + r.size * (1 - g));
    } else {
      ctx.fillText(ch, cx, y + r.size * 0.78);
    }
    cx += cw;
  }
  ctx.restore();
}

function sceneIndexAt(project, t) {
  const scenes = sceneClips(project);
  let idx = 0, since = 1e9, prev = 0;
  scenes.forEach((s, i) => { if (s.start <= t + 1e-9) { prev = idx; idx = i + 1; since = t - s.start; } });
  return { idx: Math.max(1, idx), prev: Math.max(1, prev), since, total: scenes.length };
}

register({
  type: 'index-counter',
  kind: 'component',
  label: 'Index counter',
  category: 'Chrome',
  description: '"01 / 06" counter; follows the current scene automatically.',
  duration: 4,
  schema: {
    auto: { type: 'bool', default: true, label: 'Follow scenes' },
    current: { type: 'number', min: 0, max: 99, step: 1, default: 1, label: 'Current' },
    total: { type: 'number', min: 1, max: 99, step: 1, default: 6, label: 'Total' },
    role: { type: 'enum', options: ['label', 'h2', 'h1', 'display'], default: 'h1', label: 'Size' },
    color: { type: 'color', default: 'ink', label: 'Colour' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props;
    const r = typeRole(p.role, env.frame, { font: p.role === 'label' ? 'mono' : 'display' });
    const s = p.auto ? sceneIndexAt(env.project, env.t) : { idx: p.current, prev: p.current, since: 9, total: p.total };
    const fmt = (n) => String(n).padStart(2, '0');
    const text = `${fmt(s.idx)} / ${fmt(s.total || p.total)}`;
    const prev = `${fmt(s.prev)} / ${fmt(s.total || p.total)}`;
    rollNumber(ctx, text, prev, env.anchor.x, env.anchor.y, r, s.since, color(p.color));
    setFont(ctx, r);
    env.box({ kind: 'text', role: p.role, x: env.anchor.x, y: env.anchor.y, w: ctx.measureText(text).width, h: r.size * 0.74, fg: color(p.color), size: r.size, text, settled: s.since > 0.3 });
    if (s.since < 0.3) env.animating();
  },
});

// ── Nav bar ───────────────────────────────────────────────────────────────────
register({
  type: 'nav-bar',
  kind: 'component',
  label: 'Nav bar',
  category: 'Chrome',
  description: 'Top band: brand, section links (the current scene is boxed in lime) and the 01 / 06 counter.',
  duration: 24,
  schema: {
    brand: { type: 'text', default: 'vidkit/studio', label: 'Brand', maxLength: 32 },
    links: { type: 'list', of: 'text', default: ['Title', 'Beat', 'Springs', 'Layout', 'Render', 'Start'], label: 'Links (one per scene)', maxItems: 12 },
    fill: { type: 'color', default: 'paper', label: 'Band' },
    height: { type: 'number', min: 40, max: 200, step: 1, default: 88, label: 'Height px' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u;
    const H = p.height * u, W = env.frame.w;
    const g = layoutGrid(env.frame);
    const dy = -H * 1.2 * (1 - Math.min(1.02, sp(lt, 'snappy', 'position')));
    const bw = border(env.frame);
    ctx.save();
    ctx.translate(0, dy);
    box(ctx, 0, 0, W, H, { fill: color(p.fill) });
    ctx.fillStyle = color('ink');
    ctx.fillRect(0, H - bw, W, bw);
    const brand = typeRole('label', env.frame, { font: 'display', tracking: 0 });
    setFont(ctx, brand, 0);
    ctx.fillStyle = color('ink');
    const by = H / 2 + brand.size * 0.36;
    ctx.fillText(p.brand, g.margin, by);
    env.box({ kind: 'text', role: 'label', x: g.margin, y: by - brand.size * 0.72, w: ctx.measureText(p.brand).width, h: brand.size * 0.72, fg: color('ink'), bg: color(p.fill), size: brand.size, text: p.brand });

    const lab = typeRole('label', env.frame);
    const s = sceneIndexAt(env.project, env.t);
    // Links are spread over the free span between the brand and the counter, so any
    // number of scenes (and portrait frames) get a link each.
    const fmt = (n) => String(n).padStart(2, '0');
    const counter = typeRole('label', env.frame, { font: 'mono-bold', weight: 700 });
    const txt = `${fmt(s.idx)} / ${fmt(s.total)}`;
    setFont(ctx, counter);
    const cw = ctx.measureText(txt).width;
    setFont(ctx, brand);
    const bwid = ctx.measureText(p.brand).width;
    const x0 = g.margin + bwid + 40 * u, x1 = W - g.margin - cw - 40 * u;
    const n = p.links.length;
    setFont(ctx, lab);
    const natural = (g.colW + g.gutter);
    const step = n ? Math.min(natural, (x1 - x0) / n) : natural;
    const linkX = (i) => x0 + i * step;
    // Active-link box slides between links on each cut.
    const from = linkX(Math.max(0, s.prev - 1)), to = linkX(Math.max(0, s.idx - 1));
    const k = Math.min(1.04, sp(s.since, 'snappy', 'position'));
    const bxW = step - 10 * u;
    if (n && x1 > x0) {
      box(ctx, lerp(from, to, k) - 8 * u, H * 0.22, bxW, H * 0.56, { fill: color('lime'), stroke: color('ink'), strokeW: bw * 0.6 });
    }
    setFont(ctx, lab);
    // Labels are centred in equal slots. If any label would not fit its slot (portrait frames),
    // every link falls back to its number so the strip stays consistent.
    const labels = p.links.map((l) => l.toUpperCase());
    const fits = labels.every((l) => ctx.measureText(l).width <= bxW - 16 * u);
    if (x1 > x0) labels.forEach((l, i) => {
      const t = fits ? l : fmt(i + 1);
      ctx.fillStyle = color('ink');
      ctx.fillText(t, linkX(i) - 8 * u + (bxW - ctx.measureText(t).width) / 2, H / 2 + lab.size * 0.36);
    });
    rollNumber(ctx, txt, `${fmt(s.prev)} / ${fmt(s.total)}`, W - g.margin - cw, H / 2 - counter.size * 0.42, counter, s.since, color('ink'));
    ctx.restore();
    env.box({ kind: 'text', role: 'label', x: W - g.margin - cw, y: H / 2 - counter.size * 0.4, w: cw, h: counter.size * 0.74, fg: color('ink'), bg: color(p.fill), size: counter.size, text: txt, settled: s.since > 0.3 });
    reportBox(env, { x: 0, y: dy, w: W, h: H, bleed: true });
    if (lt < 0.6 || s.since < 0.35) env.animating();
  },
});

// ── Footer bar ────────────────────────────────────────────────────────────────
register({
  type: 'footer-bar',
  kind: 'component',
  label: 'Footer bar',
  category: 'Chrome',
  description: 'Bottom band with mono metadata and a progress rule that tracks the video.',
  duration: 24,
  schema: {
    left: { type: 'text', default: 'Beat-locked motion, rendered offline', label: 'Left', maxLength: 80 },
    right: { type: 'text', default: '120 BPM — 30 FPS — 1080p', label: 'Right', maxLength: 80 },
    fill: { type: 'color', default: 'ink', label: 'Band' },
    height: { type: 'number', min: 30, max: 200, step: 1, default: 64, label: 'Height px' },
    progress: { type: 'bool', default: true, label: 'Progress rule' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u;
    const H = p.height * u, W = env.frame.w;
    const g = layoutGrid(env.frame);
    const y = env.frame.h - H + H * 1.2 * (1 - Math.min(1.02, sp(lt, 'snappy', 'position')));
    box(ctx, 0, y, W, H, { fill: color(p.fill) });
    const lab = typeRole('label', env.frame);
    setFont(ctx, lab);
    const ink = onColor(p.fill);
    ctx.fillStyle = ink;
    const by = y + H / 2 + lab.size * 0.36;
    ctx.fillText(p.left.toUpperCase(), g.margin, by);
    const rw = ctx.measureText(p.right.toUpperCase()).width;
    ctx.fillText(p.right.toUpperCase(), W - g.margin - rw, by);
    env.box({ kind: 'text', role: 'label', x: g.margin, y: by - lab.size * 0.72, w: ctx.measureText(p.left.toUpperCase()).width, h: lab.size * 0.72, fg: ink, bg: color(p.fill), size: lab.size, text: p.left });
    env.box({ kind: 'text', role: 'label', x: W - g.margin - rw, y: by - lab.size * 0.72, w: rw, h: lab.size * 0.72, fg: ink, bg: color(p.fill), size: lab.size, text: p.right });
    if (p.progress) {
      const dur = env.settings.duration ?? (clip.start + clip.duration);
      ctx.fillStyle = color('lime');
      ctx.fillRect(0, y, W * Math.min(1, env.t / dur), Math.max(3, 6 * u));
    }
    reportBox(env, { x: 0, y, w: W, h: H, bleed: true });
    env.animating();
  },
});

// ── Project card ──────────────────────────────────────────────────────────────
register({
  type: 'card',
  kind: 'component',
  label: 'Project card',
  category: 'Chrome',
  description: 'Bordered card: cover image, mono kicker, title, meta line and a status tag.',
  duration: 4,
  schema: {
    image: { type: 'asset', default: 'assets/images/film-editing-02.jpg', label: 'Image' },
    kicker: { type: 'text', default: 'Job 01', label: 'Kicker', maxLength: 24 },
    title: { type: 'text', default: 'Showcase cut', label: 'Title', maxLength: 40 },
    meta: { type: 'text', default: '1080p30 — 24.0 s', label: 'Meta', maxLength: 40 },
    tag: { type: 'text', default: 'Rendered', label: 'Status tag', maxLength: 16 },
    tag_fill: { type: 'color', default: 'lime', label: 'Tag fill' },
    width: { type: 'number', min: 100, max: 1600, step: 1, default: 440, label: 'Width px' },
    tilt: { type: 'number', min: -20, max: 20, step: 0.5, default: -2, label: 'Tilt °' },
    land_beat: { type: 'number', min: 0, max: 64, step: 1, default: 0, label: 'Land on beat #' },
    progress: { type: 'number', min: -1, max: 1, step: 0.01, default: -1, label: 'Progress (−1 = none)' },
  },
  assets: (clip, props) => [props?.image].filter(Boolean),
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u;
    const w = p.width * u * env.xf.sx;
    const imgH = w * 0.62;
    const ti = typeRole('h2', env.frame, { size: 44 });
    const lab = typeRole('label', env.frame);
    const pad = 24 * u;
    const h = imgH + pad * 2 + lab.size * 1.4 + ti.size * 1.1 + lab.size * 1.4 + (p.progress >= 0 ? 26 * u : 0) + pad * 0.5;
    const L = landing(clip.start, 'slam', env.beat, env.settings.fps, p.land_beat);
    const e = env.t - L.start;
    if (e <= 0) return;
    const g = sp(e, 'slam', 'position');
    const ex = exitP(lt, clip.duration);
    const x = env.anchor.x - w / 2;
    const y = env.anchor.y - h / 2 - env.frame.h * 0.75 * (1 - g) + env.frame.h * 1.1 * ex;
    const rot = ((p.tilt + 9 * (1 - sp(e, 'slam', 'rotation'))) * Math.PI) / 180;
    const bw = border(env.frame);
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rot); ctx.translate(-(x + w / 2), -(y + h / 2));
    box(ctx, x, y, w, h, { fill: color('white'), shadow: shadowTok(env.frame, 'video-lg') });
    imageCover(ctx, env.image(p.image), x, y, w, imgH, { focusX: 0.5, focusY: 0.45 });
    ctx.fillStyle = color('ink');
    ctx.fillRect(x, y + imgH, w, bw);
    let cy = y + imgH + pad;
    setFont(ctx, lab);
    ctx.fillStyle = color('ink-soft');
    ctx.fillText(p.kicker.toUpperCase(), x + pad, cy + lab.size * 0.8);
    cy += lab.size * 1.4;
    setFont(ctx, ti);
    ctx.fillStyle = color('ink');
    ctx.fillText(p.title, x + pad, cy + ti.size * 0.78);
    cy += ti.size * 1.1;
    setFont(ctx, lab);
    ctx.fillStyle = color('ink');
    ctx.fillText(p.meta, x + pad, cy + lab.size * 0.8);
    if (p.progress >= 0) {
      cy += lab.size * 1.4;
      const pw = w - pad * 2;
      frameRect(ctx, x + pad, cy, pw, 18 * u, Math.max(2, bw * 0.5), color('ink'));
      ctx.fillStyle = color('cobalt');
      ctx.fillRect(x + pad + bw * 0.5, cy + bw * 0.5, Math.max(0, (pw - bw) * p.progress), 18 * u - bw);
    }
    frameRect(ctx, x, y, w, h, bw, color('ink'));
    // status tag hanging off the top-right corner (breaks the card edge on purpose), drawn last
    setFont(ctx, lab);
    const tl = p.tag.toUpperCase();
    const tw = ctx.measureText(tl).width + lab.size * 1.4;
    const th = lab.size * 2;
    box(ctx, x + w - tw * 0.82, y - th * 0.55, tw, th, { fill: color(p.tag_fill), stroke: color('ink'), strokeW: bw * 0.7 });
    ctx.fillStyle = onColor(p.tag_fill);
    ctx.fillText(tl, x + w - tw * 0.82 + lab.size * 0.7, y - th * 0.55 + th / 2 + lab.size * 0.36);
    ctx.restore();
    const settled = e > settle('slam') && ex === 0;
    reportBox(env, { x, y, w, h, settled });
    env.box({ kind: 'text', role: 'h2', x: x + pad, y: y + imgH + pad + lab.size * 1.4, w: w - pad * 2, h: ti.size * 0.8, fg: color('ink'), bg: color('white'), size: ti.size, text: p.title, settled });
    if (!settled) env.animating();
  },
  events(clip, env) {
    const L = landing(clip.start, 'slam', env.beat, env.fps, env.props.land_beat);
    return [{ kind: 'hit', t: L.hit, sound: 'impact', gain_db: -7 },
      { kind: 'motion', role: 'card', start: L.start, peak: L.start + peak('slam'), settle: L.start + settle('slam'), preset: 'slam' }];
  },
});
