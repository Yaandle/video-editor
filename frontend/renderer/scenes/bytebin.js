// scene.bytebin — one episode of "Byte the Overclocked Raccoon" (@byte.dump), 9:16 dev shorts.
//
// Fixed identity (see media/bytebin/STYLE.md): a blue-black ground with a slow dot grid, paper
// slabs with hard lime shadows, orange only for "look here", three type families (Archivo
// Black, Archivo, JetBrains Mono). Byte is a pixel raccoon in a blue hoodie (ears through the
// hood, cyan eyes, the bin icon on his chest, green cuffs), drawn on a fixed block grid and
// moving in whole blocks. He comes out of the byte.dump bin and types on a keyboard on its rim.
//
// One vertical stack, centred on the safe column: Byte and the bin on top, the panel in the
// middle, captions under it. The episode is data: `beats` say which panel shows and when.
//
// Panels:  hook     kicker chip + claim slab (captions hidden: the slab is the words)
//          term     terminal: typed prompt, mock output, an ASCII train of our own
//          code     code card, one line highlighted, a stamp on its corner
//          list     key / value rows (flags, facts)
//          quote    one short quoted line with its source
//          signoff  "Back to the bin." Byte drops in, the lid shuts, the slab leaves. The last
//                   frame is the empty bin, the same as frame 0, so the loop is seamless.
//
// Safe zone: x 64..944 (right 136 px clear for app buttons), y 150..1500 (bottom ~22 % clear).

import { register } from '../registry.js';
import { color, type as typeRole } from '../tokens.js';
import { sp, clamp01 } from '../motion.js';
import { setFont } from '../kit.js';
import { box } from '../draw.js';

const SAFE = { l: 64, r: 944, top: 150, bottom: 1500 };
const CX = (SAFE.l + SAFE.r) / 2;       // 504: the safe column's centre
const PANEL_CY = 915;                   // panels centre here, between the bin and the captions
const CAP_Y = 1232;
const B = 8;                            // one pixel-art block, in 1080-wide units
const GROUND = '#0E1317', DOTS = '#1B232A', RULE = '#25303A', MUTE = '#8E9AA6';

// ---------------------------------------------------------------- Byte, 26 × 28 blocks
// Drawn from the two @byte.dump reference images: a round blue hood with the ears outside it,
// a pointed raccoon face in the hood's shadow (white brows angled in, black mask, glowing cyan
// slit eyes, white muzzle, black nose), drawstrings, the grey bin icon on the chest.
const PAL = {
  K: '#0B0E12', H: '#2F5F93', h: '#1C3A5C', L: '#4C83BC',
  G: '#9A968F', g: '#5E5A54', W: '#EEEAE0', I: '#D9CFC2',
  S: '#9DBBD9', T: '#C9CDD2', t: '#8E959D', E: '#7FF4FF', D: '#2A2724',
};
const FACE = [                           // 14 wide, rows 8..16, narrowing to the nose
  'gWWGGGKKGGGWWg',
  'KKWWWGKKGWWWKK',
  'KKEEKKGGKKEEKK',
  'KKKKKWGGWKKKKK',
  'hKKWWWWWWWWKKh',
  'hhGWWWWWWWWGhh',
  'hhhGWWWWWWGhhh',
  'hhhhGWKKWGhhhh',
  'hhhhhGWWGhhhhh',
];
const torso = (mid) => `Kh${'H'.repeat(7)}${mid}${'H'.repeat(7)}hK`;
const BYTE = [
  '....KKK..............KKK....',
  '...KgIgK............KgIgK...',
  '...KgIIgK..........KgIIgK...',
  `...KgIIg${'K'.repeat(12)}gIIgK...`,
  `..Kgg${'H'.repeat(18)}ggK..`,
  `.K${'H'.repeat(24)}K.`,
  `.K${'H'.repeat(7)}${'L'.repeat(10)}${'H'.repeat(7)}K.`,
  '.KHHHHHLgggggKKgggggLHHHHHK.',
  ...FACE.map((f) => `.KHHHHL${f}LHHHHK.`),
  `.KHHHHHL${'L'.repeat(12)}LHHHHHK.`,
  torso('SHHHHHHHHS'),                   // drawstrings, clear of the icon
  torso('SHHHHHHHHS'),
  torso('KHHHTTHHHK'),                   // aglets + the bin's handle
  torso('HHTTTTTTHH'),                   // lid
  torso('HHHTttTHHH'),                   // can
  torso('HHHTttTHHH'),
  torso('HHHTttTHHH'),
  torso('HHHTTTTHHH'),
  torso('HHHHHHHHHH'),
  torso('HHHHHHHHHH'),
  torso('HHHHHHHHHH'),
  torso('HHHHHHHHHH'),
].map((r) => r.padEnd(28, '.').slice(0, 28));
const BYTE_W = 28;
const EYES = [[9, 10], [17, 10]];        // left block of each 2×1 slit eye (col, row)
const ABOVE_RIM = 27;                    // rows showing above the rim when he's all the way out
const TAIL = ['.KDDK.', 'KDDDDK', 'KGGGGK', 'KGGGGK', 'KDDDDK', 'KDDDDK', 'KGGGGK', 'KGGGGK', 'KDDDDK', 'KDDDDK', 'KGGGGK', 'KGGGGK', 'KDDDDK', 'KDDDDK'];

const snap = (v) => Math.round(v);

function sprite(ctx, rows, x, y, b, swap = {}) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      let k = rows[r][c];
      if (k === '.') continue;
      k = swap[k] ?? k;
      ctx.fillStyle = PAL[k];
      ctx.fillRect(x + c * b, y + r * b, b, b);
    }
  }
}

function drawByte(ctx, x, y, b, o) {
  sprite(ctx, BYTE, x, y, b, o.blink ? { E: 'K' } : {});
  if (o.blink) return;
  // overclocked: a cyan glow over each slit eye (additive, deterministic)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [c, r] of EYES) {
    const ex = x + (c + 1) * b, ey = y + (r + 0.5) * b;
    const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, b * 3);
    g.addColorStop(0, 'rgba(127,244,255,0.5)');
    g.addColorStop(1, 'rgba(127,244,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(ex - b * 3, ey - b * 3, b * 6, b * 6);
  }
  ctx.restore();
}

/** Striped tail rising behind the bin's right corner; the tip sways a block every second. */
const TAIL_CURVE = [3, 3, 2, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0];   // leans out, tip curling right

function drawTail(ctx, x, y, b, lt) {
  const sway = Math.floor(lt) % 2 ? b : 0;
  TAIL.forEach((row, r) => sprite(ctx, [row], x + TAIL_CURVE[r] * b + (r < 5 ? sway : 0), y + r * b, b));
}

/** Keyboard on the rim and two paws with green cuffs; `type` lifts one paw at a time. */
function drawKeys(ctx, cx, rim, b, lt, typing) {
  const kw = 22 * b, kx = snap(cx - kw / 2), ky = rim - b;
  ctx.fillStyle = PAL.K;
  ctx.fillRect(kx - 2, ky - 2, kw + 4, 3 * b + 4);
  ctx.fillStyle = '#2A3038';
  ctx.fillRect(kx, ky, kw, 3 * b);
  // the keyboard's own cyan light, cast up like the hologram in the reference
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createLinearGradient(0, ky - 8 * b, 0, ky);
  glow.addColorStop(0, 'rgba(127,244,255,0)');
  glow.addColorStop(1, `rgba(127,244,255,${typing ? 0.2 : 0.1})`);
  ctx.fillStyle = glow;
  ctx.fillRect(kx, ky - 8 * b, kw, 8 * b);
  ctx.restore();
  const tick = Math.floor(lt * 8);
  const lit = typing ? 1 + 2 * ((tick * 7) % 10) : 19;
  for (let i = 1; i < 21; i += 2) {
    ctx.fillStyle = i === lit ? '#7FF4FF' : '#7E8893';
    ctx.fillRect(kx + i * b, ky + b * 0.5, b, b * 0.75);
  }
  const beat = tick % 2;
  for (const [side, px] of [[0, cx - 11 * b], [1, cx + 6 * b]]) {
    const lift = typing && beat === side ? b : 0;
    const x = snap(px), y = ky - 3 * b - lift;
    ctx.fillStyle = PAL.K;
    ctx.fillRect(x - 3, y - 3, 5 * b + 6, 3 * b + 6);
    ctx.fillStyle = '#3FA36B';                       // green cuff
    ctx.fillRect(x, y, 5 * b, b);
    ctx.fillStyle = '#4A4643';                       // paw
    ctx.fillRect(x, y + b, 5 * b, 2 * b);
    ctx.fillStyle = '#2B2826';                       // finger gaps
    ctx.fillRect(x + b, y + 2 * b, b, b);
    ctx.fillRect(x + 3 * b, y + 2 * b, b, b);
  }
}

/** The byte.dump bin: body below `rim`; lid hinged at its left, `open` 0 shut .. 1 upright. */
function drawBin(ctx, cx, rim, b, open) {
  const w = 32 * b, h = 18 * b, x = snap(cx - w / 2), y = snap(rim);
  ctx.fillStyle = PAL.K;
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  ctx.fillStyle = '#4C5866';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#6C7987';
  ctx.fillRect(x, y, w, 2 * b);
  ctx.fillStyle = '#3B4552';
  for (let i = 3; i < 32; i += 5) ctx.fillRect(x + i * b, y + 3 * b, b, h - 4 * b);
  ctx.fillRect(x, y + h - b, w, b);
  // label
  const lw = 16 * b, lx = snap(cx - lw / 2), ly = y + 7 * b;
  ctx.fillStyle = PAL.K;
  ctx.fillRect(lx - 3, ly - 3, lw + 6, 4 * b + 6);
  ctx.fillStyle = color('lime');
  ctx.fillRect(lx, ly, lw, 4 * b);
  ctx.fillStyle = color('ink');
  ctx.font = `700 ${Math.round(2.4 * b)}px "JetBrains Mono"`;
  ctx.textAlign = 'center';
  ctx.fillText('byte.dump', cx, ly + 2.85 * b);
  ctx.textAlign = 'left';
  // shut lid: a 34 × 2 strip on the rim with a handle (drawn in front)
  if (open < 0.04) {
    ctx.fillStyle = PAL.K;
    ctx.fillRect(x - b - 4, y - 2 * b - 4, 34 * b + 8, 2 * b + 8);
    ctx.fillRect(cx - 2 * b - 4, y - 3 * b - 4, 4 * b + 8, b + 4);
    ctx.fillStyle = '#6C7987';
    ctx.fillRect(x - b, y - 2 * b, 34 * b, 2 * b);
    ctx.fillRect(cx - 2 * b, y - 3 * b, 4 * b, b);
    ctx.fillStyle = '#56626F';
    ctx.fillRect(x - b, y - b, 34 * b, b);
  }
  return { x, y, w, h };
}

/** The open lid, flipped up behind Byte (front view: its underside, rising in whole blocks). */
function drawLidBack(ctx, cx, rim, b, open) {
  if (open < 0.04) return;
  const lh = Math.max(2, Math.round(14 * open)) * b, w = 36 * b, x = snap(cx - w / 2), y = snap(rim) - lh;
  ctx.fillStyle = PAL.K;
  ctx.fillRect(x - 4, y - 4, w + 8, lh + 4);
  ctx.fillStyle = '#56626F';
  ctx.fillRect(x, y, w, lh);
  ctx.fillStyle = '#6C7987';
  ctx.fillRect(x, y, w, b);
  ctx.fillStyle = '#46515D';
  if (lh > 4 * b) ctx.fillRect(x + 2 * b, y + 2 * b, w - 4 * b, lh - 3 * b);
}

// ---------------------------------------------------------------- type helpers
/** Greedy wrap; a "\n" in the text forces a break (to avoid one-word orphans). */
function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const wd of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${wd}` : wd;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = wd; } else line = t;
    }
    if (line) out.push(line);
  }
  return out;
}

function chip(ctx, env, text, x, y, o = {}) {
  const u = env.u;
  const { size = 30, fill = 'paper', ink = 'ink', name = 'chip', upper = true, measure = false } = o;
  const r = typeRole('label', env.frame, { font: 'code', size, weight: 700, tracking: 0.02 });
  setFont(ctx, r);
  const t = upper ? String(text).toUpperCase() : String(text);
  const pad = 16 * u;
  const w = ctx.measureText(t).width + pad * 2, h = r.size + pad * 1.3;
  if (measure) return { w, h };
  box(ctx, x, y, w, h, { fill: color(fill), stroke: color('ink'), strokeW: Math.max(2, 4 * u), shadow: { x: 6 * u, y: 6 * u, color: color('ink') } });
  ctx.fillStyle = color(ink);
  ctx.fillText(t, x + pad, y + h / 2 + r.size * 0.36);
  env.box({ kind: 'text', role: 'label', name, x, y, w, h, fg: color(ink), bg: color(fill), size: r.size, text: t });
  return { w, h };
}

/** A quiet section label: lime "//" then grey mono text. */
function label(ctx, env, text, y, lt) {
  const u = env.u;
  const r = typeRole('label', env.frame, { font: 'code', size: 28, weight: 600, tracking: 0.02 });
  setFont(ctx, r);
  ctx.save();
  ctx.globalAlpha *= clamp01(lt * 5);
  const x = SAFE.l * u + (1 - clamp01(sp(lt, 'snappy', 'position'))) * -24 * u;
  ctx.fillStyle = color('lime');
  ctx.fillText('//', x, y);
  ctx.fillStyle = MUTE;
  ctx.fillText(text, x + ctx.measureText('// ').width, y);
  ctx.restore();
  env.box({ kind: 'text', role: 'label', name: 'section', x: SAFE.l * u, y: y - r.size, w: 400 * u, h: r.size, fg: MUTE, bg: GROUND, size: r.size, text });
}

/** Display slab centred on `cy`. `{{word}}` sets words orange. Returns its box. */
function slab(ctx, env, text, cy, o = {}) {
  const u = env.u;
  const { size = 92, fill = 'paper', t = 1, name = 'slab', out = 0 } = o;
  const x = SAFE.l * u, w = (SAFE.r - SAFE.l) * u, pad = 36 * u;
  const r = typeRole('display', env.frame, { font: 'display', size, weight: 400, leading: 1.04, tracking: -0.015 });
  setFont(ctx, r);
  const plain = text.replace(/\{\{|\}\}/g, '');
  const lines = wrap(ctx, plain, w - pad * 2);
  const flat = plain.replace(/\n/g, ' ');
  const lh = r.size * 1.06;
  const h = lines.length * lh + pad * 1.4;
  const y = cy - h / 2;
  if (t <= 0) return { x, y, w, h };
  const k = clamp01(sp(t, 'slam', 'position'));
  ctx.save();
  ctx.globalAlpha *= clamp01(t * 6) * (1 - out);
  ctx.translate(x + w / 2, y + h / 2 + out * 60 * u);
  ctx.scale(0.9 + 0.1 * k, 0.9 + 0.1 * k);
  ctx.translate(-(x + w / 2), -(y + h / 2));
  box(ctx, x, y, w, h, { fill: color(fill), stroke: color('ink'), strokeW: Math.max(3, 6 * u), shadow: { x: 14 * u, y: 14 * u, color: color(fill === 'lime' ? 'paper' : 'lime') } });
  // emphasis is matched on the bare word, so "{{2}}." still lights "2."
  const bare = (w) => w.replace(/^[“”"…]+|[.,:;!?“”"…]+$/g, '');
  const emph = new Set((text.match(/\{\{(.+?)\}\}/g) ?? []).flatMap((m) => m.slice(2, -2).split(/\s+/)).map(bare));
  let yy = y + pad * 0.7 + r.size * 0.86;
  for (const ln of lines) {
    let xx = x + pad;
    for (const wd of ln.split(' ')) {
      ctx.fillStyle = emph.has(bare(wd)) ? color('orange') : color('ink');
      ctx.fillText(wd, xx, yy);
      xx += ctx.measureText(`${wd} `).width;
    }
    yy += lh;
  }
  ctx.restore();
  env.box({ kind: 'text', role: 'display', name, x, y, w, h, fg: color('ink'), bg: color(fill), size: r.size, text: flat, settled: t > 0.5 });
  return { x, y, w, h };
}

// ---------------------------------------------------------------- cards
/** When each terminal line appears: "$ " lines type their command at `cps`, then output lines
 *  pop in. Mirrored in studio/bytebin.py for the key-tick cues; keep the two in step. */
function typeTimeline(lines, cps, start = 0.15) {
  let t = start;
  return lines.map((s) => {
    if (s.startsWith('$ ')) {
      const d = (s.length - 2) / cps, seg = { t0: t, t1: t + d, typed: true };
      t += d + 0.3;
      return seg;
    }
    const seg = { t0: t, t1: t, typed: false };
    if (s) t += 0.1;
    return seg;
  });
}

function typedUntil(p) {
  if (!p.type || !p.lines) return 0;
  const tl = typeTimeline(p.lines, p.cps ?? 14);
  return Math.max(0, ...tl.filter((s) => s.typed).map((s) => s.t1));
}

/** Terminal (dark) or code (paper) card centred on `cy`. Returns its box. */
function card(ctx, env, p, cy, lt) {
  const u = env.u;
  const dark = p.kind === 'term';
  const x = SAFE.l * u, w = (SAFE.r - SAFE.l) * u;
  const fs = (p.font_px ?? (dark ? 38 : 44)) * u, lh = Math.round(fs * 1.5), pad = 30 * u, bar = 58 * u;
  const lines = p.lines ?? [];
  const h = bar + pad * 2 + Math.max(1, lines.length) * lh;
  const y = cy - h / 2;
  const k = clamp01(sp(lt, 'soft', 'position'));
  ctx.save();
  ctx.translate(0, (1 - k) * 50 * u);
  ctx.globalAlpha *= clamp01(lt * 5);
  box(ctx, x, y, w, h, { fill: dark ? '#0A0E12' : color('paper'), stroke: dark ? '#2A343E' : color('ink'), strokeW: Math.max(3, 6 * u), shadow: { x: 14 * u, y: 14 * u, color: color('lime') } });
  ctx.fillStyle = dark ? color('lime') : color('ink');
  ctx.fillRect(x, y, w, bar);
  for (let i = 0; i < 3; i++) { ctx.fillStyle = dark ? color('ink') : color('paper'); ctx.fillRect(x + (26 + i * 32) * u, y + 20 * u, 18 * u, 18 * u); }
  const tr = typeRole('label', env.frame, { font: 'code', size: 24, weight: 600 });
  setFont(ctx, tr);
  ctx.fillStyle = dark ? color('ink') : color('paper');
  ctx.fillText(p.title ?? '', x + 136 * u, y + bar / 2 + 8 * u);
  ctx.font = `500 ${fs}px "JetBrains Mono"`;
  const hl = new Set(p.hl ?? []);
  const hlAt = p.hl_at ?? 0;
  const tl = p.type ? typeTimeline(lines, p.cps ?? 14) : null;
  for (let i = 0; i < lines.length; i++) {
    const ly = y + bar + pad + i * lh;
    let s = lines[i];
    if (p.lines_at && lt < (p.lines_at[i] ?? 0)) continue;   // a line held back until its voice line
    let typingNow = false;
    if (tl) {
      const seg = tl[i];
      if (lt < seg.t0) continue;
      if (seg.typed) {
        const n = 2 + Math.floor((lt - seg.t0) * (p.cps ?? 14));
        typingNow = n < s.length || lt < seg.t1 + 0.2;
        s = s.slice(0, n);
      }
    }
    const lit = hl.has(i) && lt > hlAt;
    if (lit) {
      ctx.fillStyle = color('orange');
      ctx.fillRect(x + pad * 0.5, ly + lh * 0.06, (w - pad) * clamp01(sp(lt - hlAt, 'snappy', 'position')), lh * 0.88);
    }
    const add = s.startsWith('+ '), del = s.startsWith('- ');
    ctx.fillStyle = lit ? color('ink')
      : add ? (dark ? color('lime') : '#1E7A3C') : del ? '#C2412B'
      : dark ? (s.startsWith('$') ? color('lime') : '#E7E3D8') : color('ink');
    ctx.fillText(s, x + pad, ly + lh * 0.7);
    if (del && !lit) ctx.fillRect(x + pad + ctx.measureText('- ').width, ly + lh * 0.46, ctx.measureText(s).width - ctx.measureText('- ').width, Math.max(2, 3 * u));
    if (typingNow && Math.floor(lt * 4) % 2 === 0) {
      ctx.fillStyle = color('lime');
      ctx.fillRect(x + pad + ctx.measureText(s).width + 4 * u, ly + lh * 0.16, fs * 0.55, lh * 0.68);
    }
  }
  ctx.restore();
  env.box({ kind: 'text', role: 'code', name: p.kind, x, y, w, h, fg: dark ? '#E7E3D8' : color('ink'), bg: dark ? '#0A0E12' : color('paper'), size: fs, text: lines.join('\n') });
  return { x, y, w, h, bar, pad, lh };
}

/** Our own ASCII locomotive (not sl's art), crossing the terminal once, right to left. */
function train(ctx, env, c, lt, speed) {
  const u = env.u;
  const puff = Math.floor(lt * 4) % 2 ? '    ( )  o' : '    ()  O ';
  const art = [puff, ' ____||__________', '|  []  | ====== |\\', '|______|________|_>', ' (O)  (O)    (O)'];
  const fs = 34 * u, lh = fs * 1.15;
  ctx.font = `700 ${fs}px "JetBrains Mono"`;
  const tw = ctx.measureText(art[3]).width;
  const x = c.x + c.w - lt * speed * u;
  if (x + tw < c.x) return;
  const top = c.y + c.bar + c.pad + c.lh * 1.1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(c.x + 8 * u, top - lh, c.w - 16 * u, art.length * lh + lh);
  ctx.clip();
  ctx.fillStyle = color('lime');
  art.forEach((ln, i) => ctx.fillText(ln, x, top + i * lh));
  ctx.restore();
}

function stamp(ctx, env, text, c, t) {
  const u = env.u;
  const m = chip(ctx, env, text, 0, 0, { size: 38, measure: true });
  const sc = 1 + 0.45 * (1 - clamp01(sp(t, 'slam', 'scale')));
  ctx.save();
  ctx.globalAlpha *= clamp01(t * 8);
  ctx.translate(c.x + c.w - m.w / 2 - 24 * u, c.y + c.h - 6 * u);
  ctx.rotate(-0.06);
  ctx.scale(sc, sc);
  chip(ctx, env, text, -m.w / 2, -m.h / 2, { size: 38, fill: 'orange', name: 'stamp' });
  ctx.restore();
}

/** Key / value rows centred on `cy`, each sliding in on its own step. */
function list(ctx, env, items, cy, lt, step) {
  const u = env.u;
  const rowH = 124 * u;
  const kr = typeRole('label', env.frame, { font: 'code', size: 66, weight: 700 });
  setFont(ctx, kr);
  const keyW = Math.max(...items.map((it) => ctx.measureText(it.k).width)) + 44 * u;
  const top = cy - (items.length * rowH) / 2;
  items.forEach((it, i) => {
    const t = lt - i * step;
    if (t < 0) return;
    const y = top + i * rowH;
    ctx.save();
    ctx.globalAlpha *= clamp01(t * 6);
    ctx.translate((1 - clamp01(sp(t, 'snappy', 'position'))) * -40 * u, 0);
    ctx.fillStyle = RULE;
    ctx.fillRect(SAFE.l * u, y + rowH - 2 * u, (SAFE.r - SAFE.l) * u, 2 * u);
    setFont(ctx, kr);
    ctx.fillStyle = color('lime');
    ctx.fillText(it.k, SAFE.l * u, y + rowH * 0.66);
    const vr = typeRole('h2', env.frame, { font: 'body', size: 50, weight: 600 });
    setFont(ctx, vr);
    ctx.fillStyle = color('paper');
    ctx.fillText(it.v, SAFE.l * u + keyW, y + rowH * 0.64);
    ctx.restore();
    env.box({ kind: 'text', role: 'body', name: `row${i}`, x: SAFE.l * u, y, w: (SAFE.r - SAFE.l) * u, h: rowH, fg: color('paper'), bg: GROUND, size: vr.size, text: `${it.k} ${it.v}` });
  });
}

// ---------------------------------------------------------------- captions
/** Short chunks on a paper slab that hugs the words, centred; the spoken word sits on lime. */
function captions(ctx, env, caps, lt) {
  const u = env.u;
  const c = caps.find((k) => lt >= k.t0 && lt < k.t1);
  if (!c) return;
  const words = c.text.split(/\s+/);
  const lens = words.map((w) => w.length + 2);
  const total = lens.reduce((a, b) => a + b, 0);
  const pos = clamp01((lt - c.t0) / Math.max(0.01, (c.t1 - c.t0) * 0.92)) * total;
  let acc = 0, active = words.length - 1;
  for (let i = 0; i < words.length; i++) { acc += lens[i]; if (pos < acc) { active = i; break; } }
  const r = typeRole('h2', env.frame, { font: 'body', size: 60, weight: 800, leading: 1.1, tracking: -0.01 });
  setFont(ctx, r);
  const maxW = 780 * u, space = ctx.measureText(' ').width;
  const lines = [];
  let line = [];
  for (let i = 0; i < words.length; i++) {
    const t = [...line.map((j) => words[j]), words[i]].join(' ');
    if (ctx.measureText(t).width > maxW && line.length) { lines.push(line); line = [i]; } else line.push(i);
  }
  lines.push(line);
  const widths = lines.map((ln) => ctx.measureText(ln.map((j) => words[j]).join(' ')).width);
  const padX = 32 * u, padY = 22 * u, lh = r.size * 1.18;
  const w = Math.max(...widths) + padX * 2, h = lines.length * lh + padY * 2;
  const x = CX * u - w / 2, y = CAP_Y * u;
  const k = clamp01(sp(lt - c.t0, 'snappy', 'position'));
  ctx.save();
  ctx.translate(0, (1 - k) * 10 * u);
  box(ctx, x, y, w, h, { fill: color('paper'), stroke: color('ink'), strokeW: Math.max(3, 6 * u), shadow: { x: 10 * u, y: 10 * u, color: color('lime') } });
  lines.forEach((ln, li) => {
    let xx = CX * u - widths[li] / 2;
    const by = y + padY + li * lh;
    for (const i of ln) {
      const ww = ctx.measureText(words[i]).width;
      if (i === active) { ctx.fillStyle = color('lime'); ctx.fillRect(xx - 8 * u, by + 3 * u, ww + 16 * u, lh - 6 * u); }
      ctx.fillStyle = color('ink');
      ctx.fillText(words[i], xx, by + r.size * 0.93);
      xx += ww + space;
    }
  });
  ctx.restore();
  env.box({ kind: 'text', role: 'caption', name: 'caption', x, y, w, h, fg: color('ink'), bg: color('paper'), size: r.size, text: c.text });
}

function background(ctx, env, lt, dur) {
  const W = env.frame.w, H = env.frame.h, u = env.u;
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, W, H);
  // the grid rises a whole number of cells over the video, so the last frame meets the first
  const s = 40 * u, cells = Math.max(1, Math.round(dur / 3));
  const off = ((lt / dur) * cells * s) % s;
  ctx.fillStyle = DOTS;
  for (let y = s - off; y < H + s; y += s) for (let x = s / 2; x < W; x += s) ctx.fillRect(x, y - s, 3 * u, 3 * u);
}

// ================================================================ theme: paper (diagram look)
// White ground with a faint grid and a soft blue glow at the foot (Muse), bold sans headlines
// that build word by word and re-centre as they grow (Muse), an italic serif accent and a blue
// design-tool selection box with corner handles around the key words (the reference covers).
// Markup in any text: {{words}} = selection box, *words* = blue italic serif accent.
const PP = {
  ground: '#FFFFFF', grid: '#EDF0F5', ink: '#0E1116', mute: '#7A8494', blue: '#2563EB',
  blueFill: 'rgba(37,99,235,0.11)', border: '#E3E7EE', shadow: 'rgba(15,23,42,0.12)',
  term: '#0F1720', termText: '#E6EDF3', termMute: '#7D8A99', prompt: '#60A5FA', red: '#DC2626',
};
const SANS = (px, w = 700) => `${w} ${px}px "Archivo"`;
const SERIF = (px) => `italic 400 ${px}px Georgia, "Times New Roman", serif`;
const MONO = (px, w = 500) => `${w} ${px}px "JetBrains Mono"`;

function paperBackground(ctx, env, lt, dur) {
  const W = env.frame.w, H = env.frame.h, u = env.u;
  ctx.fillStyle = PP.ground;
  ctx.fillRect(0, 0, W, H);
  const s = 72 * u, cells = Math.max(1, Math.round(dur / 4));
  const off = ((lt / dur) * cells * s) % s;          // whole cells per video: seamless loop
  ctx.fillStyle = PP.grid;
  const lw = Math.max(1, 1.5 * u);
  for (let x = (W / 2) % s; x < W; x += s) ctx.fillRect(x, 0, lw, H);
  for (let y = s - off; y < H + s; y += s) ctx.fillRect(0, y - s, W, lw);
  const g = ctx.createLinearGradient(0, H * 0.68, 0, H);
  g.addColorStop(0, 'rgba(37,99,235,0)');
  g.addColorStop(1, 'rgba(37,99,235,0.16)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.68, W, H * 0.32);
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A soft floating card (Muse / reference UI cards). */
function softCard(ctx, u, x, y, w, h, o = {}) {
  const { fill = '#FFFFFF', r = 22 * u, border = PP.border, lift = 1 } = o;
  ctx.save();
  ctx.shadowColor = PP.shadow;
  ctx.shadowBlur = 44 * u * lift;
  ctx.shadowOffsetY = 18 * u * lift;
  rrect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
  if (border) { rrect(ctx, x, y, w, h, r); ctx.strokeStyle = border; ctx.lineWidth = Math.max(1, 1.5 * u); ctx.stroke(); }
}

/** The selection box: light blue fill, blue edge, four square handles. Grows from the left on
 *  a snappy spring, then the handles pop. `t` is time since it started. */
function selBox(ctx, u, x, y, w, h, t, o = {}) {
  if (t <= 0) return;
  const g = o.static ? 1 : clamp01(sp(t, 'snappy', 'position'));
  const bw = w * g;
  ctx.fillStyle = PP.blueFill;
  ctx.fillRect(x, y, bw, h);
  ctx.strokeStyle = PP.blue;
  ctx.lineWidth = Math.max(1.5, (o.lw ?? 2.5) * u);
  ctx.strokeRect(x, y, bw, h);
  const hs = (o.handle ?? 10) * u * (o.static ? 1 : clamp01(sp(t - 0.12, 'slam', 'scale')));
  if (hs <= 0.5 || g < 0.9) return;
  for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
  }
}

/** Parse {{sel}} and *serif* markup into words with flags. "\n" forces a line break. */
function richWords(text) {
  const out = [];
  let sel = 0, serif = false, group = 0;
  for (const raw of String(text).replace(/\n/g, ' \n ').split(/ +/)) {
    if (raw === '\n') { out.push({ br: true }); continue; }
    if (!raw) continue;
    let w = raw;
    const openSel = w.startsWith('{{'); if (openSel) { w = w.slice(2); sel = ++group; }
    const openSerif = w.startsWith('*'); if (openSerif) { w = w.slice(1); serif = true; }
    let closeSel = false, closeSerif = false;
    if (w.endsWith('}}')) { w = w.slice(0, -2); closeSel = true; }
    if (w.endsWith('*')) { w = w.slice(0, -1); closeSerif = true; }
    if (w.endsWith('}}')) { w = w.slice(0, -2); closeSel = true; }
    out.push({ text: w, sel, serif });
    if (closeSel) sel = 0;
    if (closeSerif) serif = false;
  }
  return out;
}

/** Muse-style headline: words land one by one (snappy), each line re-centres as it grows,
 *  selection boxes draw round their words once those words have landed. Returns its bounds. */
function headline(ctx, env, text, cy, t, o = {}) {
  const u = env.u;
  const size = (o.size ?? 104) * u, maxW = (o.maxW ?? 860) * u, lh = size * 1.14;
  const stagger = o.stagger ?? 0.075, alpha = o.alpha ?? 1;
  const words = richWords(text);
  const fontOf = (w) => (w.serif ? SERIF(size * 1.1) : SANS(size));
  // wrap
  const lines = [[]];
  let lw = 0;
  for (const w of words) {
    if (w.br) { lines.push([]); lw = 0; continue; }
    ctx.font = fontOf(w);
    w.w = ctx.measureText(w.text).width;
    const sp_ = ctx.measureText(' ').width;
    const cur = lines[lines.length - 1];
    if (cur.length && lw + sp_ + w.w > maxW) { lines.push([w]); lw = w.w; } else { lw += (cur.length ? sp_ : 0) + w.w; cur.push(w); }
  }
  const nonEmpty = lines.filter((l) => l.length);
  const top = cy - (nonEmpty.length * lh) / 2;
  ctx.font = SANS(size);
  const space = ctx.measureText(' ').width;
  let k = 0, last = 0;
  const boxes = [];
  ctx.save();
  ctx.globalAlpha *= alpha;
  nonEmpty.forEach((ln, li) => {
    const base = top + li * lh + size * 0.86;
    const prog = ln.map((w, i) => clamp01(sp(t - (k + i) * stagger, 'snappy', 'position')));
    const width = ln.reduce((a, w, i) => a + (w.w + (i ? space : 0)) * prog[i], 0);
    let x = CX * u - width / 2;
    ln.forEach((w, i) => {
      const wt = t - (k + i) * stagger;
      last = Math.max(last, (k + i) * stagger);
      if (i) x += space * prog[i];
      if (wt > 0) {
        const s = 0.82 + 0.18 * clamp01(sp(wt, 'snappy', 'scale'));
        ctx.save();
        ctx.globalAlpha *= clamp01(wt * 9);
        ctx.translate(x + w.w / 2, base - size * 0.3);
        ctx.scale(s, s);
        ctx.font = fontOf(w);
        ctx.fillStyle = w.serif ? PP.blue : PP.ink;
        ctx.fillText(w.text, -w.w / 2, size * 0.3);
        ctx.restore();
        if (w.sel) boxes.push({ g: w.sel, x, y: base - size * 0.86, w: w.w * prog[i], h: size * 1.08, at: (k + i) * stagger });
      }
      x += w.w * prog[i];
    });
    k += ln.length;
  });
  // one box per selection group per line, behind nothing (drawn over, it's translucent)
  const groups = new Map();
  for (const bx of boxes) {
    const key = `${bx.g}:${Math.round(bx.y)}`;
    const gb = groups.get(key);
    if (!gb) groups.set(key, { ...bx });
    else { gb.w = bx.x + bx.w - gb.x; gb.at = Math.max(gb.at, bx.at); }
  }
  for (const gb of groups.values()) selBox(ctx, u, gb.x - 12 * u, gb.y - 2 * u, gb.w + 24 * u, gb.h, t - gb.at - 0.12);
  ctx.restore();
  const h = nonEmpty.length * lh;
  env.box({ kind: 'text', role: 'display', name: o.name ?? 'headline', x: CX * u - maxW / 2, y: top, w: maxW, h, fg: PP.ink, bg: PP.ground, size, text: words.filter((w) => !w.br).map((w) => w.text).join(' '), settled: t > last + 0.5 });
  return { y: top, h, end: last };
}

/** Pill chip with a dot (reference: "• @mrcreates.ai", "• LIVE"). Centred on x when align = 'center'. */
function pill(ctx, env, text, x, y, o = {}) {
  const u = env.u;
  const size = (o.size ?? 28) * u;
  ctx.font = MONO(size, 600);
  const tw = ctx.measureText(text).width;
  const dot = o.dot === false ? 0 : 22 * u;
  const w = tw + dot + 44 * u, h = size + 26 * u;
  const bx = o.align === 'center' ? x - w / 2 : x;
  softCard(ctx, u, bx, y, w, h, { r: h / 2, lift: 0.45, fill: o.fill ?? '#FFFFFF', border: o.fill ? null : PP.border });
  if (dot) { ctx.fillStyle = o.dotColor ?? PP.blue; ctx.beginPath(); ctx.arc(bx + 26 * u, y + h / 2, 6 * u, 0, Math.PI * 2); ctx.fill(); }
  ctx.font = MONO(size, 600);
  ctx.fillStyle = o.ink ?? PP.ink;
  ctx.fillText(text, bx + 22 * u + dot, y + h / 2 + size * 0.36);
  env.box({ kind: 'text', role: 'label', name: o.name ?? 'pill', x: bx, y, w, h, fg: o.ink ?? PP.ink, bg: o.fill ?? '#FFFFFF', size, text });
  return { x: bx, y, w, h };
}

function paperLabel(ctx, env, text, y, lt) {
  const u = env.u;
  ctx.save();
  ctx.globalAlpha *= clamp01(lt * 5);
  ctx.font = MONO(26 * u, 600);
  ctx.fillStyle = PP.blue;
  ctx.fillText('//', SAFE.l * u, y);
  ctx.fillStyle = PP.mute;
  ctx.fillText(text, SAFE.l * u + ctx.measureText('// ').width, y);
  ctx.restore();
}

/** Terminal (dark, soft shadow, traffic lights) or code (white) card centred on cy. */
function paperCard(ctx, env, p, cy, lt) {
  const u = env.u;
  const dark = p.kind === 'term';
  const x = SAFE.l * u, w = (SAFE.r - SAFE.l) * u;
  const fs = (p.font_px ?? (dark ? 36 : 40)) * u, lh = Math.round(fs * 1.55), pad = 34 * u, bar = 62 * u;
  const lines = p.lines ?? [];
  const h = bar + pad * 1.6 + Math.max(1, lines.length) * lh;
  const y = cy - h / 2;
  const k = clamp01(sp(lt, 'soft', 'position'));
  ctx.save();
  ctx.globalAlpha *= clamp01(lt * 5);
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(0.94 + 0.06 * k, 0.94 + 0.06 * k);
  ctx.translate(-(x + w / 2), -(y + h / 2) + (1 - k) * 30 * u);
  softCard(ctx, u, x, y, w, h, { fill: dark ? PP.term : '#FFFFFF', border: dark ? null : PP.border, lift: 1.3 });
  if (!dark) { ctx.save(); rrect(ctx, x, y, w, bar, 22 * u); ctx.clip(); ctx.fillStyle = '#F6F8FA'; ctx.fillRect(x, y, w, bar); ctx.restore(); ctx.fillStyle = PP.border; ctx.fillRect(x, y + bar, w, Math.max(1, 1.5 * u)); }
  ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + (34 + i * 30) * u, y + bar / 2, 8 * u, 0, Math.PI * 2); ctx.fill(); });
  ctx.font = MONO(22 * u, 600);
  ctx.fillStyle = dark ? PP.termMute : PP.mute;
  ctx.fillText(p.title ?? '', x + 140 * u, y + bar / 2 + 8 * u);
  const hl = new Set(p.hl ?? []), hlAt = p.hl_at ?? 0;
  const tl = p.type ? typeTimeline(lines, p.cps ?? 14) : null;
  ctx.font = MONO(fs);
  for (let i = 0; i < lines.length; i++) {
    const ly = y + bar + pad * 0.8 + i * lh;
    let s = lines[i];
    if (p.lines_at && lt < (p.lines_at[i] ?? 0)) continue;
    let typingNow = false;
    if (tl) {
      const seg = tl[i];
      if (lt < seg.t0) continue;
      if (seg.typed) { const n = 2 + Math.floor((lt - seg.t0) * (p.cps ?? 14)); typingNow = n < s.length || lt < seg.t1 + 0.2; s = s.slice(0, n); }
    }
    if (hl.has(i) && lt > hlAt) {
      const g = clamp01(sp(lt - hlAt, 'snappy', 'position'));
      ctx.fillStyle = dark ? 'rgba(96,165,250,0.22)' : PP.blueFill;
      ctx.fillRect(x + 12 * u, ly + lh * 0.04, (w - 24 * u) * g, lh * 0.92);
      ctx.fillStyle = PP.blue;
      ctx.fillRect(x + 12 * u, ly + lh * 0.04, 5 * u, lh * 0.92);
    }
    const cut = s.indexOf('  #');
    const main = cut >= 0 ? s.slice(0, cut) : s, note = cut >= 0 ? s.slice(cut) : '';
    const add = main.startsWith('+ '), del = main.startsWith('- ');
    ctx.fillStyle = add ? '#16A34A' : del ? PP.red : dark ? (main.startsWith('$') ? PP.prompt : PP.termText) : PP.ink;
    ctx.fillText(main, x + pad, ly + lh * 0.68);
    if (note) { ctx.fillStyle = dark ? PP.termMute : PP.mute; ctx.fillText(note, x + pad + ctx.measureText(main).width, ly + lh * 0.68); }
    if (typingNow && Math.floor(lt * 4) % 2 === 0) { ctx.fillStyle = PP.prompt; ctx.fillRect(x + pad + ctx.measureText(s).width + 4 * u, ly + lh * 0.18, fs * 0.55, lh * 0.64); }
  }
  ctx.restore();
  env.box({ kind: 'text', role: 'code', name: p.kind, x, y, w, h, fg: dark ? PP.termText : PP.ink, bg: dark ? PP.term : '#FFFFFF', size: fs, text: lines.join('\n') });
  return { x, y, w, h };
}

/** Key / value rows inside one soft card. */
function paperList(ctx, env, items, cy, lt, step) {
  const u = env.u;
  const rowH = 112 * u, pad = 40 * u;
  const x = SAFE.l * u, w = (SAFE.r - SAFE.l) * u, h = items.length * rowH + pad;
  const y = cy - h / 2;
  const k = clamp01(sp(lt, 'soft', 'position'));
  ctx.save();
  ctx.globalAlpha *= clamp01(lt * 5);
  ctx.translate(0, (1 - k) * 30 * u);
  softCard(ctx, u, x, y, w, h, { lift: 1.1 });
  ctx.font = MONO(46 * u, 700);
  const keyW = Math.max(...items.map((it) => ctx.measureText(it.k).width)) + 44 * u;
  items.forEach((it, i) => {
    const t = lt - 0.15 - i * step;
    if (t < 0) return;
    const ry = y + pad / 2 + i * rowH;
    ctx.save();
    ctx.globalAlpha *= clamp01(t * 6);
    ctx.translate((1 - clamp01(sp(t, 'snappy', 'position'))) * -30 * u, 0);
    if (i) { ctx.fillStyle = PP.grid; ctx.fillRect(x + pad, ry, w - pad * 2, Math.max(1, 2 * u)); }
    ctx.font = MONO(46 * u, 700);
    ctx.fillStyle = it.hot ? PP.red : PP.blue;
    ctx.fillText(it.k, x + pad, ry + rowH * 0.62);
    ctx.font = SANS(42 * u, 600);
    ctx.fillStyle = PP.ink;
    ctx.fillText(it.v, x + pad + keyW, ry + rowH * 0.62);
    ctx.restore();
  });
  ctx.restore();
  env.box({ kind: 'text', role: 'body', name: 'list', x, y, w, h, fg: PP.ink, bg: '#FFFFFF', size: 42 * u, text: items.map((it) => `${it.k} ${it.v}`).join(' / ') });
  return { y, h };
}

/** "Going deeper": nodes stacked downward, each joined by a line that draws itself. */
function chain(ctx, env, items, cy, lt, step) {
  const u = env.u;
  const nh = 78 * u, gap = 30 * u, n = items.length;
  const top = cy - (n * nh + (n - 1) * gap) / 2;
  items.forEach((it, i) => {
    const at = 0.1 + i * step;
    const ny = top + i * (nh + gap);
    if (i) {   // connector from the node above, drawn in the gap before this node lands
      const g = clamp01((lt - (at - 0.3)) / 0.3);
      if (g > 0) {
        ctx.fillStyle = PP.blue;
        ctx.fillRect(CX * u - 1.5 * u, ny - gap, 3 * u, gap * g);
        if (g >= 1) { ctx.beginPath(); ctx.moveTo(CX * u - 8 * u, ny - 9 * u); ctx.lineTo(CX * u + 8 * u, ny - 9 * u); ctx.lineTo(CX * u, ny - 1 * u); ctx.closePath(); ctx.fill(); }
      }
    }
    const t = lt - at;
    if (t <= 0) return;
    ctx.font = MONO(34 * u, 700);
    const kw = ctx.measureText(it.k).width;
    ctx.font = SANS(26 * u, 500);
    const vw = it.v ? ctx.measureText(it.v).width + 26 * u : 0;
    const w = Math.max(300 * u, kw + vw + 96 * u), x = CX * u - w / 2;
    const s = 0.86 + 0.14 * clamp01(sp(t, 'slam', 'scale'));
    ctx.save();
    ctx.globalAlpha *= clamp01(t * 7);
    ctx.translate(CX * u, ny + nh / 2);
    ctx.scale(s, s);
    ctx.translate(-CX * u, -(ny + nh / 2));
    softCard(ctx, u, x, ny, w, nh, { r: 18 * u, lift: 0.7, border: it.hot ? PP.red : PP.border });
    ctx.fillStyle = it.hot ? PP.red : PP.blue;
    ctx.beginPath(); ctx.arc(x + 36 * u, ny + nh / 2, 8 * u, 0, Math.PI * 2); ctx.fill();
    ctx.font = MONO(34 * u, 700);
    ctx.fillStyle = it.hot ? PP.red : PP.ink;
    ctx.fillText(it.k, x + 62 * u, ny + nh / 2 + 12 * u);
    if (it.v) { ctx.font = SANS(26 * u, 500); ctx.fillStyle = PP.mute; ctx.fillText(it.v, x + 62 * u + kw + 26 * u, ny + nh / 2 + 10 * u); }
    ctx.restore();
    if (it.hot) selBox(ctx, u, x - 10 * u, ny - 10 * u, w + 20 * u, nh + 20 * u, t - 0.35, { handle: 11 });
    env.box({ kind: 'text', role: 'body', name: `node${i}`, x, y: ny, w, h: nh, fg: PP.ink, bg: '#FFFFFF', size: 34 * u, text: `${it.k} ${it.v ?? ''}` });
  });
}

/** Muse's "Done!": the words pop, then a circle draws and ticks, and the words slide over. */
function doneMark(ctx, env, text, sub, cy, lt) {
  const u = env.u;
  const size = 100 * u;
  ctx.font = SANS(size);
  const tw = ctx.measureText(text).width;
  const ring = 34 * u, gapR = 26 * u;
  const c = clamp01(sp(lt - 0.45, 'snappy', 'position'));       // the ring's arrival
  const shift = (ring * 2 + gapR) * c;
  const x0 = CX * u - (tw + shift) / 2;
  const pop = 0.8 + 0.2 * clamp01(sp(lt, 'slam', 'scale'));
  ctx.save();
  ctx.globalAlpha *= clamp01(lt * 8);
  ctx.translate(x0 + shift + tw / 2, cy);
  ctx.scale(pop, pop);
  ctx.fillStyle = PP.ink;
  ctx.fillText(text, -tw / 2, size * 0.34);
  ctx.restore();
  if (lt > 0.45) {
    const a = clamp01((lt - 0.45) / 0.35);
    const rx = x0 + ring, ry = cy;
    ctx.strokeStyle = PP.blue;
    ctx.lineWidth = 7 * u;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(rx, ry, ring, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * a); ctx.stroke();
    const tk = clamp01((lt - 0.8) / 0.2);
    if (tk > 0) {
      ctx.beginPath();
      ctx.moveTo(rx - 14 * u, ry + 1 * u);
      const mx = rx - 4 * u, my = ry + 11 * u;
      if (tk < 0.5) ctx.lineTo(rx - 14 * u + (mx - (rx - 14 * u)) * tk * 2, ry + 1 * u + (my - ry - 1 * u) * tk * 2);
      else { ctx.lineTo(mx, my); ctx.lineTo(mx + (16 * u) * (tk - 0.5) * 2, my - (22 * u) * (tk - 0.5) * 2); }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
  if (sub && lt > 0.9) {
    ctx.save();
    ctx.globalAlpha *= clamp01((lt - 0.9) * 5);
    ctx.font = SANS(40 * u, 500);
    ctx.fillStyle = PP.mute;
    const sw = ctx.measureText(sub).width;
    ctx.fillText(sub, CX * u - sw / 2, cy + size * 0.95);
    ctx.restore();
  }
  env.box({ kind: 'text', role: 'display', name: 'done', x: x0, y: cy - size / 2, w: tw + shift, h: size, fg: PP.ink, bg: PP.ground, size, text });
}

/** Captions with no slab: black words, and the selection box gliding to the spoken word. */
function paperCaptions(ctx, env, caps, lt) {
  const u = env.u;
  const c = caps.find((k) => lt >= k.t0 && lt < k.t1);
  if (!c) return;
  const words = c.text.split(/\s+/);
  const lens = words.map((w) => w.length + 2);
  const total = lens.reduce((a, b) => a + b, 0);
  const span = Math.max(0.01, (c.t1 - c.t0) * 0.92);
  const starts = [];
  let acc = 0;
  for (const l of lens) { starts.push(c.t0 + (acc / total) * span); acc += l; }
  let a = 0;
  for (let i = 0; i < words.length; i++) if (lt >= starts[i]) a = i;
  const size = 60 * u;
  ctx.font = SANS(size);
  const space = ctx.measureText(' ').width, maxW = 820 * u, lh = size * 1.25;
  const lines = [];
  let line = [];
  for (let i = 0; i < words.length; i++) {
    const t = [...line.map((j) => words[j]), words[i]].join(' ');
    if (ctx.measureText(t).width > maxW && line.length) { lines.push(line); line = [i]; } else line.push(i);
  }
  lines.push(line);
  const rects = [];
  const y0 = CAP_Y * u;
  const k = clamp01(sp(lt - c.t0, 'snappy', 'position'));
  lines.forEach((ln, li) => {
    const lw = ctx.measureText(ln.map((j) => words[j]).join(' ')).width;
    let x = CX * u - lw / 2;
    for (const i of ln) { const ww = ctx.measureText(words[i]).width; rects[i] = { x, y: y0 + li * lh, w: ww }; x += ww + space; }
  });
  // the box glides from the previous word to the spoken one
  const cur = rects[a], prev = rects[a - 1] ?? { ...cur, w: 0 };
  const g = clamp01(sp(lt - starts[a], 'snappy', 'position'));
  const bx = prev.x + (cur.x - prev.x) * g, by = prev.y + (cur.y - prev.y) * g, bw = prev.w + (cur.w - prev.w) * g;
  ctx.save();
  ctx.globalAlpha *= clamp01((lt - c.t0) * 10);
  ctx.translate(0, (1 - k) * 8 * u);
  selBox(ctx, u, bx - 10 * u, by - 2 * u, bw + 20 * u, size * 1.12, 1, { static: true, handle: 8, lw: 2.5 });
  ctx.fillStyle = PP.ink;
  ctx.font = SANS(size);
  words.forEach((w, i) => ctx.fillText(w, rects[i].x, rects[i].y + size * 0.86));
  ctx.restore();
  env.box({ kind: 'text', role: 'caption', name: 'caption', x: CX * u - maxW / 2, y: y0, w: maxW, h: lines.length * lh, fg: PP.ink, bg: PP.ground, size, text: c.text });
}

/** Every panel in the paper look. */
function paperPanel(ctx, env, cur, bt, cy, signoff) {
  const u = env.u;
  if (cur.panel === 'hook') {
    const m = headline(ctx, env, cur.claim ?? '', cy + 34 * u, bt - 0.12, { size: cur.size ?? 108, name: 'claim' });
    if (bt > 0.02) {
      ctx.save();
      ctx.globalAlpha *= clamp01(bt * 6);
      pill(ctx, env, cur.kicker ?? "Today's trash find", CX * u, m.y - 92 * u, { align: 'center', name: 'kicker' });
      ctx.restore();
    }
  } else if (cur.panel === 'term' || cur.panel === 'code') {
    const c = paperCard(ctx, env, { ...cur, kind: cur.panel }, cy, bt);
    if (cur.label) paperLabel(ctx, env, cur.label, c.y - 34 * u, bt);
    if (cur.stamp && bt > (cur.stamp_at ?? 1)) {
      const st = bt - (cur.stamp_at ?? 1);
      ctx.save();
      ctx.globalAlpha *= clamp01(st * 8);
      const s = 0.8 + 0.2 * clamp01(sp(st, 'slam', 'scale'));
      ctx.translate(c.x + c.w - 30 * u, c.y + c.h);
      ctx.scale(s, s);
      ctx.font = MONO(30 * u, 700);
      const w = ctx.measureText(cur.stamp).width + 74 * u;
      pill(ctx, env, cur.stamp, -w, -30 * u, { size: 30, fill: PP.blue, ink: '#FFFFFF', dot: false, name: 'stamp' });
      ctx.restore();
    }
  } else if (cur.panel === 'list') {
    const m = paperList(ctx, env, cur.items ?? [], cy, bt, cur.step ?? 0.5);
    if (cur.label) paperLabel(ctx, env, cur.label, m.y - 34 * u, bt);
  } else if (cur.panel === 'chain') {
    const n = (cur.items ?? []).length;
    if (cur.label) paperLabel(ctx, env, cur.label, cy - (n * 78 + (n - 1) * 30) * u / 2 - 34 * u, bt);
    chain(ctx, env, cur.items ?? [], cy, bt, cur.step ?? 0.8);
  } else if (cur.panel === 'done') {
    doneMark(ctx, env, cur.text ?? 'Done!', cur.sub, cy, bt);
  } else if (cur.panel === 'quote') {
    const m = headline(ctx, env, cur.quote ?? '', cy, bt - 0.05, { size: cur.size ?? 96, name: 'quote' });
    if (cur.label) paperLabel(ctx, env, cur.label, m.y - 50 * u, bt);
    if (cur.source && bt > m.end + 0.3) {
      ctx.save();
      ctx.globalAlpha *= clamp01((bt - m.end - 0.3) * 5);
      ctx.font = MONO(28 * u, 600);
      ctx.fillStyle = PP.mute;
      const s = `— ${cur.source}`, sw = ctx.measureText(s).width;
      ctx.fillText(s, CX * u - sw / 2, m.y + m.h + 60 * u);
      ctx.restore();
    }
  } else if (signoff) {
    const fade = clamp01((bt - ((cur.drop_at ?? 1.0) + 0.35)) / 0.25);
    headline(ctx, env, cur.line ?? 'Back to the *bin.*', cy - 20 * u, bt, { size: 116, alpha: 1 - fade, name: 'signoff' });
  }
}

register({
  type: 'scene.bytebin',
  kind: 'scene',
  label: 'Byte bin episode',
  category: 'Explainers',
  description: 'A Byte the Overclocked Raccoon (@byte.dump) dev short: hook, the find, why it is wild, "Back to the bin." Built by `python -m studio.bytebin`.',
  duration: 30,
  schema: {
    pillar: { type: 'text', default: 'Trash find', label: 'Pillar (not drawn)', maxLength: 30 },
    beats: { type: 'list', of: 'object', default: [], label: 'Beats [{t0, t1, panel, ...}]' },
    captions: { type: 'list', of: 'object', default: [], label: 'Captions [{t0, t1, text}]' },
    draft: { type: 'bool', default: false, label: 'Draft stamp' },
    theme: { type: 'enum', options: ['night', 'paper'], default: 'night', label: 'Theme' },
    handle: { type: 'text', default: '', label: 'Cover handle pill (paper)', maxLength: 40 },
  },
  clipLabel: (clip) => `bytebin · ${clip.props?.pillar ?? ''}`,

  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u;
    const dur = clip.duration ?? 30;
    const paper = p.theme === 'paper';
    if (paper) paperBackground(ctx, env, lt, dur); else background(ctx, env, lt, dur);
    const beats = p.beats ?? [];
    const cur = beats.find((b) => lt >= b.t0 && lt < b.t1) ?? beats[beats.length - 1] ?? { panel: 'hook', t0: 0 };
    const bt = lt - cur.t0;
    const signoff = cur.panel === 'signoff';

    // ---- Byte and the bin
    const b = Math.round(B * u), cx = snap(CX * u), rim = snap(470 * u);
    const rise = lt < 0.05 ? 0 : sp(lt - 0.05, 'slam', 'position');
    const dropT = signoff ? bt - (cur.drop_at ?? 1.0) : -1;
    const down = dropT > 0 ? clamp01(sp(dropT, 'quick', 'position')) : 0;
    const shut = dropT > 0.12 ? clamp01(sp(dropT - 0.12, 'quick', 'position')) : 0;
    const out = rise * (1 - down);
    const settled = out > 0.98 && lt > 0.6;
    const bob = settled && lt % 1 < 0.13 ? -b : 0;              // a one-block hop every second
    const yOff = Math.round(((1 - out) * (ABOVE_RIM + 1) * b) / b) * b;   // whole-block motion
    const byteX = cx - (BYTE_W / 2) * b, byteY = rim - ABOVE_RIM * b + yOff + bob;
    const lid = clamp01(rise * 1.6) * (1 - shut);
    drawLidBack(ctx, cx, rim, b, lid);
    drawBin(ctx, cx, rim, b, lid);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, env.frame.w, rim);
    ctx.clip();
    drawTail(ctx, cx + 14 * b, rim - 12 * b + Math.round(((1 - out) * 14 * b) / b) * b, b, lt);
    const blink = settled && Math.floor(lt * 30) % 96 < 4;
    drawByte(ctx, byteX, byteY, b, { blink });
    ctx.restore();
    if (out > 0.02) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, env.frame.w, rim + 2 * b + 4);
      ctx.clip();
      ctx.translate(0, yOff);
      const typing = (cur.panel === 'term' && bt < typedUntil(cur)) || (cur.panel === 'code' && bt < 1.2);
      drawKeys(ctx, cx, rim, b, lt, typing);
      ctx.restore();
    }
    env.box({ kind: 'image', role: 'mascot', name: 'byte', x: cx - 16 * b, y: rim - ABOVE_RIM * b, w: 36 * b, h: (ABOVE_RIM + 18) * b });

    // ---- the panel
    const cy = PANEL_CY * u;
    if (paper) {
      paperPanel(ctx, env, cur, bt, cy, signoff);
      // the handle pill on top: the cover's brand mark on the hook, the sign-off's handle at the
      // end. It's on frame 0 and on the last frame, so the loop seam stays clean.
      if ((cur.panel === 'hook' || signoff) && p.handle) pill(ctx, env, p.handle, CX * u, 168 * u, { align: 'center', size: 24, name: 'handle' });
      if (cur.panel !== 'hook' && !signoff) paperCaptions(ctx, env, p.captions ?? [], lt);
      env.animating();
      return;
    }
    if (cur.panel === 'hook') {
      const m = slab(ctx, env, cur.claim ?? '', cy, { size: cur.size ?? 96, t: 0 });   // measure
      const kt = bt - 0.02;
      if (kt > 0) {
        ctx.save();
        ctx.globalAlpha *= clamp01(kt * 6);
        ctx.translate(0, (1 - clamp01(sp(kt, 'snappy', 'position'))) * 20 * u);
        chip(ctx, env, cur.kicker ?? "Today's trash find:", SAFE.l * u, m.y - 84 * u, { size: 36, fill: 'lime', name: 'kicker' });
        ctx.restore();
      }
      slab(ctx, env, cur.claim ?? '', cy, { size: cur.size ?? 96, t: bt - 0.1, name: 'claim' });
    } else if (cur.panel === 'term' || cur.panel === 'code') {
      const c = card(ctx, env, { ...cur, kind: cur.panel }, cy, bt);
      if (cur.label) label(ctx, env, cur.label, c.y - 44 * u, bt);
      if (cur.train && bt > 0.8) train(ctx, env, c, bt - 0.8, cur.train);
      if (cur.stamp && bt > (cur.stamp_at ?? 1)) stamp(ctx, env, cur.stamp, c, bt - (cur.stamp_at ?? 1));
    } else if (cur.panel === 'list') {
      const items = cur.items ?? [];
      if (cur.label) label(ctx, env, cur.label, cy - (items.length * 124 * u) / 2 - 30 * u, bt);
      list(ctx, env, items, cy, bt, cur.step ?? 0.5);
    } else if (cur.panel === 'quote') {
      const m = slab(ctx, env, cur.quote ?? '', cy, { size: cur.size ?? 88, t: bt - 0.05, name: 'quote' });
      if (cur.label) label(ctx, env, cur.label, m.y - 44 * u, bt);
      if (cur.source && bt > 0.4) {
        const r = typeRole('label', env.frame, { font: 'code', size: 30, weight: 600 });
        setFont(ctx, r);
        ctx.save();
        ctx.globalAlpha *= clamp01((bt - 0.4) * 5);
        ctx.fillStyle = MUTE;
        ctx.fillText(`— ${cur.source}`, SAFE.l * u, m.y + m.h + 70 * u);
        ctx.restore();
      }
    } else if (signoff) {
      const fade = clamp01((bt - ((cur.drop_at ?? 1.0) + 0.35)) / 0.25);
      const m = slab(ctx, env, cur.line ?? 'Back to the bin.', cy - 30 * u, { size: 124, fill: 'lime', t: bt, name: 'signoff', out: fade });
      if (cur.handle && bt > 0.2 && fade < 1) {
        ctx.save();
        ctx.globalAlpha *= clamp01((bt - 0.2) * 5) * (1 - fade);
        chip(ctx, env, cur.handle, SAFE.l * u, m.y + m.h + 44 * u + fade * 60 * u, { size: 30, fill: 'paper', name: 'handle', upper: false });
        ctx.restore();
      }
    }

    if (cur.panel !== 'hook' && !signoff) captions(ctx, env, p.captions ?? [], lt);
    if (p.draft) chip(ctx, env, 'Draft', SAFE.l * u, 1440 * u, { size: 22, fill: 'orange', name: 'draft' });
    env.animating();
  },
});
