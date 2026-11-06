// diagram — node/arrow infographics that build on the beat.
//   network: layers of nodes ("3, 5, 5, 2"); each layer lands on its beat,
//            edges grow from the previous layer as it approaches, then an
//            activation pulse travels input → output, one layer per beat.
//   flow:    a row of stage boxes ("Data, Features, Model, Prediction");
//            each lands on its beat and an arrow draws on from the stage
//            before; afterwards a lime focus steps along the stages.
// Every landing is a slam spring that arrives on a grid line.

import { register } from '../registry.js';
import { color, border, shadow as shadowTok, unit, type as typeRole, onColor } from '../tokens.js';
import { box, arrow as drawArrow } from '../draw.js';
import { sp, clamp01, settle, peak, exitProgress } from '../motion.js';
import { landOnBeat, setFont } from '../kit.js';
import { layoutText, drawText } from '../text.js';

export const list = (s) => String(s ?? '').split(',').map((v) => v.trim()).filter(Boolean);
export const sizes = (s) => list(s).map((v) => Math.max(1, Math.min(16, Math.round(Number(v)) || 1)));

/** Beat each layer/stage lands on, and the first beat of the steady (pulse/focus) phase. */
export function buildSchedule(clip, p, n, beat, fps) {
  const land = Array.from({ length: n }, (_, i) => landOnBeat(clip.start, p.start_beat + i * p.beats_per_step, 'slam', beat, fps));
  const steady = landOnBeat(clip.start, p.start_beat + n * p.beats_per_step, 'snappy', beat, fps);
  return { land, steady };
}

function nodePositions(layers, x0, y0, W, H) {
  const cols = layers.length;
  const colGap = cols > 1 ? W / (cols - 1) : 0;
  const maxN = Math.max(...layers);
  const rowGap = H / Math.max(1, maxN);
  const r = Math.min(colGap * 0.16 || 40, rowGap * 0.34);
  return { r, pos: layers.map((n, i) => Array.from({ length: n }, (_, j) => ({ x: x0 + i * colGap, y: y0 + H / 2 + (j - (n - 1) / 2) * rowGap }))) };
}

register({
  type: 'diagram',
  kind: 'component',
  label: 'Diagram',
  category: 'Data',
  description: 'Node/arrow infographic that builds on the beat: a neural network (layers, edges, activation pulses) or a flow of stages joined by arrows.',
  duration: 8,
  schema: {
    mode: { type: 'enum', options: ['network', 'flow'], default: 'network', label: 'Diagram' },
    layers: { type: 'text', default: '3, 5, 5, 2', label: 'Layer sizes (network)', maxLength: 60 },
    layer_labels: { type: 'text', default: 'Inputs, Hidden, Hidden, Output', label: 'Layer labels', maxLength: 160 },
    in_labels: { type: 'text', default: '', label: 'Input node labels', maxLength: 160 },
    out_labels: { type: 'text', default: '', label: 'Output node labels', maxLength: 160 },
    stages: { type: 'text', default: 'Data, Features, Model, Prediction', label: 'Stages (flow)', maxLength: 240 },
    start_beat: { type: 'number', min: 0, max: 64, step: 0.5, default: 1, label: 'First layer/stage on beat #' },
    beats_per_step: { type: 'number', min: 0.5, max: 8, step: 0.5, default: 1, label: 'Beats per layer/stage' },
    pulses: { type: 'bool', default: true, label: 'Activation pulses / stage focus afterwards' },
    highlight: { type: 'number', min: -1, max: 16, step: 1, default: -1, label: 'Highlight output node / stage (−1 none)' },
    fill: { type: 'color', default: 'white', label: 'Node / box fill' },
    accent: { type: 'color', default: 'lime', label: 'Active fill' },
    width: { type: 'number', min: 0.2, max: 1, step: 0.01, default: 0.72, label: 'Width (frame)' },
    height: { type: 'number', min: 0.2, max: 1, step: 0.01, default: 0.6, label: 'Height (frame)' },
  },
  clipLabel: (clip) => `diagram · ${clip.props?.mode ?? 'network'}`,
  render(ctx, clip, lt, env) {
    const p = env.props;
    const u = unit(env.frame);
    const W = p.width * env.frame.w * env.xf.sx, H = p.height * env.frame.h * env.xf.sy;
    const x0 = env.anchor.x - W / 2, y0 = env.anchor.y - H / 2;
    const bw = border(env.frame);
    const lab = typeRole('label', env.frame);
    const ex = exitProgress(lt, clip.duration, 0.4, 'quick');
    const B = env.beat?.valid ? env.beat.beat : 0.5;
    ctx.save();
    ctx.translate(0, env.frame.h * 0.9 * ex);
    let settled = !ex;
    if (p.mode === 'flow') {
      const stages = list(p.stages);
      const n = stages.length;
      if (!n) { ctx.restore(); return; }
      const { land, steady } = buildSchedule(clip, p, n, env.beat, env.settings.fps);
      const gap = Math.min(110 * u, W * 0.08);
      const bwid = (W - gap * (n - 1)) / n, bh = Math.min(H, bwid * 0.75);
      const by = y0 + (H - bh) / 2;
      // Label size: the role size, shrunk until the longest word fits its box.
      const role = typeRole(n > 4 ? 'body' : 'h2', env.frame);
      setFont(ctx, role);
      const longest = Math.max(...stages.flatMap((st) => st.split(/\s+/)).map((wd) => ctx.measureText(wd).width), 1);
      const fit = Math.min(1, (bwid - bw * 6) / longest);
      const h2 = typeRole(n > 4 ? 'body' : 'h2', env.frame, { size: Math.max(18, (role.size * fit) / u) });
      const focusIdx = p.pulses && env.t >= steady.hit ? Math.floor((env.t - steady.hit) / B) % n : -1;
      stages.forEach((name, i) => {
        const e = env.t - land[i].start;
        const bx = x0 + i * (bwid + gap);
        if (i > 0) {
          // Arrow from the previous stage draws on while this stage approaches.
          const g = clamp01(sp(e + 0.15, 'snappy', 'position'));
          if (g > 0) {
            const ax = bx - gap + bw, aw = (gap - bw * 2) * g;
            ctx.fillStyle = color('ink');
            ctx.fillRect(ax, by + bh / 2 - bw * 0.6, Math.max(0, aw - gap * 0.3), bw * 1.2);
            if (g > 0.6) drawArrow(ctx, ax + aw - gap * 0.62, by + bh / 2 - gap * 0.32, gap * 0.64, { dir: 'right', color: color('ink'), weight: 0.2 });
          }
        }
        if (e <= 0) { settled = false; return; }
        const k = sp(e, 'slam', 'position');
        const dy = (1 - k) * env.frame.h * 0.45;
        const active = i === focusIdx || i === p.highlight;
        const fill = active ? p.accent : p.fill;
        box(ctx, bx, by + dy, bwid, bh, { fill: color(fill), stroke: color('ink'), strokeW: bw, shadow: shadowTok(env.frame) });
        setFont(ctx, lab);
        ctx.fillStyle = onColor(fill);
        ctx.fillText(String(i + 1).padStart(2, '0'), bx + bw * 3, by + dy + bw * 3 + lab.size * 0.8);
        const lay = layoutText(ctx, { text: name, font: h2.font, size: h2.size, leading: 1.05, tracking: h2.tracking, maxWidth: bwid - bw * 6, align: 'left' });
        drawText(ctx, lay, bx + bw * 3, by + dy + bh - bw * 3 - lay.height, { color: onColor(fill) });
        env.box({ kind: 'text', role: n > 4 ? 'body' : 'h2', x: bx + bw * 3, y: by + dy + bh - bw * 3 - lay.height, w: lay.width, h: lay.height, fg: onColor(fill), bg: color(fill), size: h2.size, text: name, settled: e > settle('slam') && !ex });
        if (e < settle('slam')) settled = false;
      });
    } else {
      const layers = sizes(p.layers);
      if (!layers.length) { ctx.restore(); return; }
      const labels = list(p.layer_labels);
      const ins = list(p.in_labels), outs = list(p.out_labels);
      const padL = ins.length ? 150 * u : 40 * u, padR = outs.length ? 150 * u : 40 * u;
      const top = lab.size * 2.4;
      const { r, pos } = nodePositions(layers, x0 + padL, y0 + top, W - padL - padR, H - top);
      const { land, steady } = buildSchedule(clip, p, layers.length, env.beat, env.settings.fps);
      const L = layers.length;
      const wave = p.pulses && env.t >= steady.hit ? Math.floor((env.t - steady.hit) / B) : -1;
      const hop = wave >= 0 ? wave % Math.max(1, L - 1) : -1;
      const hopK = wave >= 0 ? clamp01(sp(env.t - steady.hit - wave * B, 'snappy', 'position')) : 0;
      // Edges (behind nodes): grow from layer i-1 as layer i approaches.
      ctx.lineCap = 'round';
      for (let i = 1; i < L; i++) {
        const g = clamp01(sp(env.t - land[i].start + 0.2, 'snappy', 'position'));
        if (g <= 0) continue;
        const live = hop === i - 1;
        ctx.strokeStyle = color(live ? 'ink' : 'ink-soft');
        ctx.globalAlpha = live ? 0.55 + 0.45 * (1 - hopK) : 0.28;
        ctx.lineWidth = Math.max(1.5, bw * (live ? 0.45 : 0.3));
        ctx.beginPath();
        for (const a of pos[i - 1]) for (const b of pos[i]) { ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + (b.x - a.x) * g, a.y + (b.y - a.y) * g); }
        ctx.stroke();
        ctx.globalAlpha = 1;
        // Pulse dots travelling this layer's edges.
        if (live) {
          ctx.fillStyle = color('orange');
          for (const a of pos[i - 1]) for (const b of pos[i]) {
            const q = { x: a.x + (b.x - a.x) * hopK, y: a.y + (b.y - a.y) * hopK };
            ctx.fillRect(q.x - bw * 0.55, q.y - bw * 0.55, bw * 1.1, bw * 1.1);
          }
        }
      }
      // Nodes.
      for (let i = 0; i < L; i++) {
        const e = env.t - land[i].start;
        if (e <= 0) { settled = false; continue; }
        if (e < settle('slam')) settled = false;
        pos[i].forEach((q, j) => {
          const s = Math.max(0, sp(e - j * 0.025, 'slam', 'scale'));
          if (s <= 0) return;
          const active = (hop >= 0 && (hop + 1 === i ? hopK > 0.85 : hop === i)) || (i === L - 1 && j === p.highlight && env.t >= steady.hit);
          const fill = color(active ? p.accent : p.fill);
          ctx.beginPath(); ctx.arc(q.x + bw * 0.6, q.y + bw * 0.6, r * s, 0, Math.PI * 2); ctx.fillStyle = color('ink'); ctx.fill();
          ctx.beginPath(); ctx.arc(q.x, q.y, r * s, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
          ctx.lineWidth = bw * 0.7; ctx.strokeStyle = color('ink'); ctx.stroke();
        });
        setFont(ctx, lab);
        if (labels[i]) {
          ctx.fillStyle = color('ink');
          const w = ctx.measureText(labels[i]).width;
          ctx.fillText(labels[i], pos[i][0].x - w / 2, y0 + lab.size);
          env.box({ kind: 'text', role: 'label', x: pos[i][0].x - w / 2, y: y0, w, h: lab.size, fg: color('ink'), size: lab.size, text: labels[i], settled: e > settle('slam') && !ex });
        }
        const side = i === 0 ? ins : i === L - 1 ? outs : [];
        side.forEach((t, j) => {
          if (!pos[i][j]) return;
          ctx.fillStyle = color('ink');
          const w = ctx.measureText(t).width;
          const tx = i === 0 ? pos[i][j].x - r - lab.size * 0.6 - w : pos[i][j].x + r + lab.size * 0.6;
          ctx.fillText(t, tx, pos[i][j].y + lab.size * 0.35);
        });
      }
    }
    ctx.restore();
    env.box({ kind: 'box', x: x0, y: y0, w: W, h: H, settled });
    env.animating();
  },
  events(clip, env) {
    const p = env.props;
    const n = p.mode === 'flow' ? list(p.stages).length : sizes(p.layers).length;
    if (!n) return [];
    const { land, steady } = buildSchedule(clip, p, n, env.beat, env.fps);
    const out = land.flatMap((l, i) => [
      { kind: 'hit', t: l.hit, sound: i === n - 1 ? 'impact' : 'pop', gain_db: i === n - 1 ? -6 : -9 },
      { kind: 'motion', role: p.mode, start: l.start, peak: l.start + peak('slam'), settle: l.start + settle('slam'), preset: 'slam' },
    ]);
    if (p.pulses) {
      const B = env.beat?.valid ? env.beat.beat : 0.5;
      for (let t = steady.hit; t < clip.start + clip.duration - 0.45; t += B) out.push({ kind: 'cue', t, sound: 'tick', gain_db: -18 });
    }
    return out;
  },
});
