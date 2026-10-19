// text — the Advanced Text component: type-ramp sizes, palette colours,
// highlight/accent markup, brutal plates, and per-line/word/char springs.
// Text Studio (frontend/textstudio.html) edits exactly these props.

import { register } from '../registry.js';
import { layoutText } from '../text.js';
import { textBlock } from '../kit.js';
import { type as typeRole, color, unit, shadow as shadowTok, border } from '../tokens.js';
import { box } from '../draw.js';
import { sp, arrival, staggerStep, peak, settle, arrivalFrames } from '../motion.js';

/**
 * Beat-locked schedule. With `hit` on and a beat grid, each line/block lands on
 * a grid line: the first on the first grid line at or after the natural arrival,
 * the rest one grid step (or the nearest whole number of steps to the stagger)
 * apart. Shared by render() and events() so pictures and sounds agree.
 */
export function scheduleText(clip, p, beat, fps) {
  const natural = { delay: p.anim_delay ?? 0, stagger: p.anim_stagger || staggerStep(p.anim_unit) };
  if (!p.hit || !beat || !beat.valid || !['line', 'block'].includes(p.anim_unit) || p.anim_from === 'none' || p.anim_from === 'type') return natural;
  const lead = arrivalFrames(fps, p.anim_preset) / fps;
  const want = clip.start + natural.delay + lead;
  const k = Math.ceil((want - beat.offset) / beat.step - 1e-6);
  const firstHit = beat.offset + k * beat.step;
  const steps = Math.max(1, Math.round((p.anim_stagger || beat.step) / beat.step));
  return { delay: firstHit - lead - clip.start, stagger: steps * beat.step };
}

const ROLES = ['hero', 'display', 'h1', 'h2', 'body', 'label', 'micro'];
const FROMS = ['none', 'rise', 'drop', 'left', 'right', 'scale', 'mask', 'tilt', 'type'];
const EXITS = ['none', 'drop', 'rise', 'left', 'right', 'mask', 'fade'];
const PRESETS = ['snappy', 'slam', 'soft', 'quick', 'wobble'];

/** Text style preset library — Text Studio and the properties panel apply these. */
export const TEXT_STYLES = {
  'headline-slam':  { label: 'Headline slam',   role: 'display', color: 'ink', anim_unit: 'line', anim_from: 'mask', anim_preset: 'slam', exit_to: 'mask', hit: true },
  'hero-statement': { label: 'Hero statement',  role: 'hero', color: 'ink', anim_unit: 'line', anim_from: 'mask', anim_preset: 'slam', exit_to: 'mask', hit: true },
  'kinetic-words':  { label: 'Kinetic words',   role: 'h1', color: 'ink', anim_unit: 'word', anim_from: 'tilt', anim_preset: 'slam', exit_to: 'drop' },
  'editorial-deck': { label: 'Editorial deck',  role: 'h2', color: 'ink', anim_unit: 'word', anim_from: 'rise', anim_preset: 'soft', exit_to: 'fade' },
  'body-copy':      { label: 'Body copy',       role: 'body', color: 'ink', anim_unit: 'line', anim_from: 'rise', anim_preset: 'soft', exit_to: 'fade' },
  'label-mono':     { label: 'Label (mono)',    role: 'label', color: 'ink', case: 'upper', anim_unit: 'char', anim_from: 'rise', anim_preset: 'snappy', exit_to: 'fade' },
  'caption-bar':    { label: 'Caption bar',     role: 'body', color: 'paper', plate: 'box', plate_fill: 'ink', anim_unit: 'word', anim_from: 'rise', anim_preset: 'snappy', exit_to: 'drop' },
  'sticker-note':   { label: 'Sticker note',    role: 'h2', color: 'ink', plate: 'shadow-box', plate_fill: 'lime', anim_unit: 'block', anim_from: 'scale', anim_preset: 'wobble', exit_to: 'drop' },
  'typewriter':     { label: 'Typewriter',      role: 'body', font: 'mono', color: 'ink', anim_from: 'type', exit_to: 'fade' },
};

export function applyStyle(props, styleId) {
  const s = TEXT_STYLES[styleId];
  if (!s) return props;
  const { label, ...rest } = s;
  return { ...props, style: styleId, plate: 'none', font: 'auto', case: 'as-typed', ...rest };
}

register({
  type: 'text',
  kind: 'component',
  label: 'Text',
  category: 'Text',
  description: 'A text block on the type ramp with spring-animated lines, words or characters. Supports [[highlight]] and {{accent}} markup.',
  duration: 4,
  schema: {
    text: { type: 'text', default: 'Every frame is a function of time.', label: 'Text', multiline: true, maxLength: 600 },
    style: { type: 'enum', options: ['custom', ...Object.keys(TEXT_STYLES)], default: 'headline-slam', label: 'Style preset' },
    role: { type: 'enum', options: ROLES, default: 'display', label: 'Size' },
    font: { type: 'enum', options: ['auto', 'display', 'body', 'mono', 'code'], default: 'auto', label: 'Font' },
    weight: { type: 'number', min: 100, max: 900, step: 50, default: 0, label: 'Weight (0 = role)' },
    size_px: { type: 'number', min: 0, max: 600, step: 1, default: 0, label: 'Size override px (0 = ramp)' },
    color: { type: 'color', default: 'ink', label: 'Colour' },
    accent: { type: 'color', default: 'cobalt', label: 'Accent {{…}}' },
    highlight: { type: 'color', default: 'lime', label: 'Highlight [[…]]' },
    align: { type: 'enum', options: ['left', 'right', 'center'], default: 'left', label: 'Align' },
    width: { type: 'number', min: 0.05, max: 1, step: 0.01, default: 0.72, label: 'Wrap width (frame)' },
    case: { type: 'enum', options: ['as-typed', 'upper', 'lower'], default: 'as-typed', label: 'Case' },
    leading: { type: 'number', min: 0, max: 3, step: 0.02, default: 0, label: 'Leading (0 = role)' },
    tracking: { type: 'number', min: -0.1, max: 0.4, step: 0.005, default: 0, label: 'Tracking em' },
    plate: { type: 'enum', options: ['none', 'box', 'shadow-box'], default: 'none', label: 'Plate' },
    plate_fill: { type: 'color', default: 'lime', label: 'Plate fill' },
    outline: { type: 'number', min: 0, max: 20, step: 0.5, default: 0, label: 'Outline px' },
    outline_color: { type: 'color', default: 'ink', label: 'Outline colour' },
    hard_shadow: { type: 'bool', default: false, label: 'Hard text shadow' },
    anim_unit: { type: 'enum', options: ['block', 'line', 'word', 'char'], default: 'line', label: 'Animate by' },
    anim_from: { type: 'enum', options: FROMS, default: 'mask', label: 'Entrance' },
    anim_preset: { type: 'enum', options: PRESETS, default: 'slam', label: 'Spring' },
    anim_stagger: { type: 'number', min: 0, max: 2, step: 0.005, default: 0, label: 'Stagger s (0 = token)' },
    anim_delay: { type: 'number', min: 0, max: 30, step: 0.01, default: 0, label: 'Delay s' },
    exit_to: { type: 'enum', options: EXITS, default: 'mask', label: 'Exit' },
    exit_preset: { type: 'enum', options: PRESETS, default: 'quick', label: 'Exit spring' },
    hit: { type: 'bool', default: true, label: 'Impact on landing' },
    sfx: { type: 'bool', default: true, label: 'Sound effects' },
  },
  label(clip) { return `"${String(clip.props?.text ?? '').replace(/\n/g, ' ').slice(0, 26)}"`; },

  render(ctx, clip, lt, env) {
    const p = env.props;
    const role = p.role;
    const r = typeRole(role, env.frame, {
      ...(p.font !== 'auto' ? { font: p.font } : {}),
      ...(p.size_px ? { size: p.size_px / unit(env.frame) } : {}),
      ...(p.weight ? { weight: p.weight } : {}),
      ...(p.leading ? { leading: p.leading } : {}),
      ...(p.tracking ? { tracking: p.tracking } : {}),
    });
    const maxWidth = p.width * env.frame.w * (env.xf.sx ?? 1);
    const spec = { text: p.text, font: r.font, size: r.size, leading: r.leading, tracking: r.tracking, maxWidth, align: p.align, case: p.case === 'as-typed' ? undefined : p.case };
    const lay = layoutText(ctx, spec);
    const x = env.anchor.x, y = env.anchor.y;
    const left = p.align === 'right' ? x - maxWidth : p.align === 'center' ? x - maxWidth / 2 : x;
    const sched = scheduleText(clip, p, env.beat, env.settings.fps);
    const enter = p.anim_from === 'none' ? null : {
      unit: p.anim_unit, from: p.anim_from, preset: p.anim_preset,
      stagger: sched.stagger, delay: sched.delay, cps: 28,
    };
    const exit = p.exit_to === 'none' ? null : { to: p.exit_to, preset: p.exit_preset };

    if (p.plate !== 'none') {
      const pad = r.size * 0.32;
      const inkL = left + Math.min(...lay.lines.map((l) => l.offset));
      const px = inkL - pad, py = y - pad, pw = lay.width + pad * 2, ph = lay.height + pad * 2;
      const e = lt - sched.delay;
      const grow = enter ? Math.max(0, Math.min(1.03, sp(e, 'snappy', 'scale'))) : 1;
      const xLen = 0.4, xs = lt - (clip.duration - xLen);
      const shrink = exit && xs > 0 ? Math.max(0, 1 - sp(xs, 'quick', 'scale')) : 1;
      if (grow * shrink > 0.001) {
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(grow * shrink, 1);
        box(ctx, 0, 0, pw, ph, {
          fill: color(p.plate_fill), stroke: color('ink'), strokeW: border(env.frame),
          shadow: p.plate === 'shadow-box' ? shadowTok(env.frame) : null,
        });
        ctx.restore();
      }
      if (enter || exit) env.animating();
    }

    textBlock(ctx, env, {
      text: p.text, role, x, y, maxWidth, align: p.align,
      color: p.color, accent: p.accent, highlight: p.highlight,
      bg: p.plate !== 'none' ? p.plate_fill : null,
      case: p.case === 'as-typed' ? undefined : p.case,
      font: p.font !== 'auto' ? p.font : undefined,
      sizePx: p.size_px || undefined, weight: p.weight || undefined,
      leading: p.leading || undefined, tracking: p.tracking || undefined,
      lt, duration: clip.duration, enter, exit,
      stroke: p.outline > 0 ? { width: p.outline * unit(env.frame), color: color(p.outline_color) } : null,
      shadow: p.hard_shadow ? { x: r.size * 0.06, y: r.size * 0.06, color: color('ink') } : null,
    });
    if (enter && lt < 2.5) env.animating();
  },

  events(clip, env) {
    const p = env.props;
    if (p.anim_from === 'none') return [];
    const out = [];
    const text = String(p.text ?? '');
    const unitName = p.anim_unit;
    const counts = {
      block: 1,
      line: text.split('\n').length,
      word: text.replace(/\[\[|\]\]|\{\{|\}\}/g, '').split(/\s+/).filter(Boolean).length,
      char: text.replace(/\[\[|\]\]|\{\{|\}\}|\s/g, '').length,
    };
    const sched = scheduleText(clip, p, env.beat, env.fps);
    const step = sched.stagger;
    const preset = p.anim_preset;
    const t0 = clip.start + sched.delay;
    const n = p.anim_from === 'type' ? 1 : counts[unitName] ?? 1;
    const last = t0 + Math.max(0, n - 1) * step;
    out.push({ kind: 'motion', role: 'text-enter', start: t0, peak: last + peak(preset), settle: last + settle(preset), preset });
    if (!p.sfx) return out;
    if (p.anim_from === 'type') {
      const words = counts.word;
      const chars = counts.char;
      // one soft tick per word, on the frame its first letter types
      let idx = 0;
      for (const w of text.split(/\s+/).filter(Boolean)) {
        out.push({ kind: 'cue', t: t0 + idx / 28, sound: 'tick', gain_db: -16 });
        idx += w.length;
      }
      if (!words || !chars) return out;
      return out;
    }
    const hitty = p.hit && (preset === 'slam' || preset === 'snappy') && ['mask', 'rise', 'drop', 'tilt', 'scale', 'left', 'right'].includes(p.anim_from);
    const fire = unitName === 'line' || unitName === 'block' ? n : Math.min(n, 1);
    for (let i = 0; i < fire; i++) {
      const tStart = t0 + i * step;
      if (hitty) {
        const th = tStart + Math.ceil(arrival(preset) * env.fps - 1e-9) / env.fps;
        out.push({ kind: 'hit', t: th, sound: i === 0 ? 'impact' : 'pop', gain_db: i === 0 ? -5 : -9 });
      } else {
        out.push({ kind: 'cue', t: tStart, sound: 'whoosh', gain_db: -12 });
      }
    }
    if (unitName === 'word' || unitName === 'char') {
      out.push({ kind: 'cue', t: t0, sound: 'whoosh', gain_db: -12 });
    }
    return out;
  },
});
