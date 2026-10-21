// code — a terminal/editor window with syntax colouring. Tokenizer ported from
// vidkit canvas.js (tokenizeCode, with its operator colouring and 0b/0o
// literals); window restyled as a brutal panel: ink border, hard shadow, lime
// title bar, optional `$ prompt` line.
//
// Reveal: 'lines' lands one line per beat step (each line rises in on a
// spring that *arrives* on its grid line, with a tick), 'type' types at a
// fixed rate, 'none' shows it all. Focus: line ranges ("3-5, 8") light up from
// `focus_beat` while the rest dims. Diff: lines starting with + / − get
// green/red bars and gutter markers (the marker is not typed as code).

import { register } from '../registry.js';
import { color, border, shadow as shadowTok, unit, family } from '../tokens.js';
import { box } from '../draw.js';
import { sp, fade, clamp01, settle, peak } from '../motion.js';
import { landOnBeat } from '../kit.js';

const KEYWORDS = {
  python: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield',
  js: 'await break case catch class const continue default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while yield null true false undefined',
  c: 'auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while include define bool true false',
};

const THEMES = {
  paper: { bg: 'white', text: 'ink', comment: 'ink-soft', keyword: 'orange', string: 'cobalt', number: 'orange', fn: 'cobalt', op: 'ink-soft', gutter: 'paper-deep', title: 'lime', add: '#D9F2C4', del: '#FFD6CC', focus: 'lime' },
  ink:   { bg: 'ink', text: 'paper', comment: '#9A968C', keyword: 'lime', string: '#8FA2FF', number: 'orange', fn: 'lime', op: '#C9C4B8', gutter: '#262523', title: 'lime', add: '#1E3A1A', del: '#4A1C14', focus: '#33320F' },
};

export function tokenize(code, lang) {
  const kw = new Set((KEYWORDS[lang] ?? KEYWORDS.python).split(' '));
  const rules = [
    [/(#|\/\/)[^\n]*/g, 'comment'],
    [/"""[\s\S]*?"""|'''[\s\S]*?'''/g, 'string'],
    [/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, 'string'],
    [/\b(0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.\d+|\d+)\b/g, 'number'],
    [/\b[A-Za-z_][A-Za-z0-9_]*(?=\s*\()/g, 'fn'],
    [/\b[A-Za-z_][A-Za-z0-9_]*\b/g, 'word'],
    [/[=+\-*/%<>!&|^~@]+/g, 'op'],
  ];
  const spans = [];
  for (const [re, kind] of rules) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) {
      const k = kind === 'word' || kind === 'fn' ? (kw.has(m[0]) ? 'keyword' : kind === 'fn' ? 'fn' : 'text') : kind;
      spans.push({ s: m.index, e: m.index + m[0].length, k });
      if (!m[0].length) re.lastIndex++;
    }
  }
  spans.sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  let cur = 0;
  for (const sp2 of spans) {
    if (sp2.s < cur) continue;
    if (sp2.s > cur) out.push({ text: code.slice(cur, sp2.s), k: 'text' });
    out.push({ text: code.slice(sp2.s, sp2.e), k: sp2.k });
    cur = sp2.e;
  }
  if (cur < code.length) out.push({ text: code.slice(cur), k: 'text' });
  const lines = [[]];
  for (const tok of out) {
    tok.text.split('\n').forEach((part, i) => {
      if (i) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, k: tok.k });
    });
  }
  return lines;
}

/** "3-5, 8" → Set{3,4,5,8} (1-based line numbers). Invalid parts are ignored. */
export function parseRanges(spec) {
  const out = new Set();
  for (const part of String(spec ?? '').split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b) && i - Math.min(a, b) < 500; i++) out.add(i);
  }
  return out;
}

/** Diff mode: strip a leading +/- (or a space) from each line and remember it. */
export function diffLines(code) {
  return String(code).split('\n').map((ln) => {
    const m = ln.match(/^([+-]) ?/);
    if (m) return { mark: m[1], text: ln.slice(m[0].length) };
    return { mark: ' ', text: ln.startsWith(' ') ? ln.slice(1) : ln };
  });
}

/** Grid-landed reveal times for each line (reveal = 'lines'). */
export function lineSchedule(clip, p, n, beat, fps) {
  return Array.from({ length: n }, (_, i) => landOnBeat(clip.start, p.start_beat + i * p.beats_per_line, 'snappy', beat, fps));
}

const CACHE = new Map();

function prepared(p) {
  const key = `${p.code}|${p.language}|${p.diff}`;
  if (!CACHE.has(key)) {
    if (CACHE.size > 200) CACHE.clear();
    const dl = p.diff ? diffLines(p.code) : String(p.code).split('\n').map((t) => ({ mark: ' ', text: t }));
    const lines = tokenize(dl.map((d) => d.text).join('\n'), p.language);
    CACHE.set(key, { lines, marks: dl.map((d) => d.mark) });
  }
  return CACHE.get(key);
}

register({
  type: 'code',
  kind: 'component',
  label: 'Code window',
  category: 'Text',
  description: 'Syntax-coloured code in a brutal window: lines land on the beat (or type in), line ranges come into focus, and +/- diffs get green/red bars.',
  duration: 6,
  schema: {
    code: { type: 'text', default: 'def snap(t, bpm=120, fps=30):\n    step = 60 / bpm\n    return round(t / step) * step', label: 'Code', multiline: true, maxLength: 4000 },
    language: { type: 'enum', options: ['python', 'js', 'c'], default: 'python', label: 'Language' },
    title: { type: 'text', default: 'beatgrid.py', label: 'Title' },
    prompt: { type: 'text', default: '', label: 'Prompt line ($ …)', maxLength: 120 },
    theme: { type: 'enum', options: ['paper', 'ink'], default: 'ink', label: 'Theme' },
    width: { type: 'number', min: 0.2, max: 1, step: 0.01, default: 0.62, label: 'Width (frame)' },
    reveal: { type: 'enum', options: ['lines', 'type', 'none'], default: 'type', label: 'Reveal' },
    typewriter: { type: 'bool', default: true, label: 'Type it in (legacy; reveal = type)' },
    cps: { type: 'number', min: 2, max: 400, step: 1, default: 45, label: 'Chars per second (type)' },
    start_beat: { type: 'number', min: 0, max: 64, step: 1, default: 1, label: 'First line on beat # (lines)' },
    beats_per_line: { type: 'number', min: 0.5, max: 8, step: 0.5, default: 1, label: 'Beats per line (lines)' },
    focus: { type: 'text', default: '', label: 'Focus lines, e.g. 3-5, 8', maxLength: 80 },
    focus_beat: { type: 'number', min: 0, max: 64, step: 1, default: 6, label: 'Focus from beat #' },
    diff: { type: 'bool', default: false, label: 'Diff (+/- lines)' },
    font_px: { type: 'number', min: 8, max: 80, step: 1, default: 30, label: 'Code size px' },
  },
  clipLabel: (clip) => `code · ${clip.props?.title ?? ''}`,
  render(ctx, clip, lt, env) {
    const p = env.props;
    const u = unit(env.frame);
    const th = THEMES[p.theme] ?? THEMES.ink;
    const { lines, marks } = prepared(p);
    const fs = p.font_px * u;
    const lh = Math.round(fs * 1.5);
    const titleH = Math.round(fs * 1.9);
    const promptH = p.prompt ? lh : 0;
    const pad = fs * 0.9;
    const gutter = fs * (p.diff ? 3.4 : 2.6);
    const w = p.width * env.frame.w * env.xf.sx;
    const h = titleH + promptH + pad * 2 + lines.length * lh;
    const x = env.anchor.x - w / 2, y = env.anchor.y - h / 2;
    const bw = border(env.frame);
    box(ctx, x, y, w, h, { fill: color(th.bg), stroke: color('ink'), strokeW: bw, shadow: shadowTok(env.frame) });
    ctx.fillStyle = color(th.title);
    ctx.fillRect(x + bw, y + bw, w - bw * 2, titleH - bw);
    ctx.fillStyle = color('ink');
    ctx.fillRect(x, y + titleH - bw, w, bw);
    ctx.font = `700 ${Math.round(fs * 0.8)}px "${family('mono-bold')}"`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(p.title, x + pad, y + titleH / 2);
    for (let i = 0; i < 3; i++) {                         // window controls as squares
      const s = fs * 0.55;
      ctx.fillRect(x + w - pad - (i + 1) * s * 1.7, y + titleH / 2 - s / 2, s, s);
    }
    const codeFont = `${Math.round(fs)}px "${family('code')}"`;
    ctx.textBaseline = 'alphabetic';
    if (p.prompt) {
      ctx.font = codeFont;
      ctx.fillStyle = color(th.fn);
      ctx.fillText(`$ ${p.prompt}`, x + pad, y + titleH + pad * 0.6 + fs * 0.8);
    }
    const top = y + titleH + promptH;
    ctx.fillStyle = color(th.gutter);
    ctx.fillRect(x + bw, top, gutter, h - titleH - promptH - bw);

    const mode = p.reveal === 'type' && !p.typewriter ? 'none' : p.reveal;
    const sched = mode === 'lines' ? lineSchedule(clip, p, lines.length, env.beat, env.settings.fps) : null;
    const focus = parseRanges(p.focus);
    const focusT = focus.size ? landOnBeat(clip.start, p.focus_beat, 'snappy', env.beat, env.settings.fps) : null;
    const fk = focusT ? clamp01(sp(env.t - focusT.start, 'snappy', 'opacity')) : 0;
    const shown = mode === 'type' ? Math.floor(Math.max(0, lt) * p.cps) : Infinity;
    let used = 0, cx = 0, cy = 0, animating = false;
    for (let i = 0; i < lines.length; i++) {
      const rowTop = top + pad + i * lh;
      const by = rowTop + fs * 0.8;
      let a = 1, dy = 0;
      if (sched) {
        const e = env.t - sched[i].start;
        if (e <= 0) { animating = true; continue; }
        dy = lh * 0.7 * (1 - sp(e, 'snappy', 'position'));
        a = fade(e * 2, 'snappy');
        if (e < settle('snappy')) animating = true;
      }
      const inFocus = focus.has(i + 1);
      const dim = focus.size && !inFocus ? 1 - 0.65 * fk : 1;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.translate(0, dy);
      // Row backgrounds: diff bars, then the focus band.
      const mark = marks[i];
      if (mark !== ' ') {
        ctx.fillStyle = color(mark === '+' ? th.add : th.del);
        ctx.fillRect(x + bw + gutter, rowTop - lh * 0.12, w - gutter - bw * 2, lh);
      }
      if (inFocus && fk > 0) {
        ctx.fillStyle = color(th.focus);
        ctx.globalAlpha *= fk * (p.theme === 'paper' ? 0.55 : 1);
        ctx.fillRect(x + bw + gutter, rowTop - lh * 0.12, (w - gutter - bw * 2) * fk, lh);
        ctx.globalAlpha /= fk * (p.theme === 'paper' ? 0.55 : 1);
      }
      ctx.globalAlpha *= dim;
      ctx.font = codeFont;
      ctx.fillStyle = color(th.comment);
      ctx.textAlign = 'right';
      ctx.fillText(String(i + 1), x + gutter - fs * (p.diff ? 1.4 : 0.5), by);
      if (mark !== ' ') {
        ctx.fillStyle = color(mark === '+' ? 'lime' : 'orange');
        ctx.fillText(mark === '+' ? '+' : '−', x + gutter - fs * 0.35, by);
      }
      ctx.textAlign = 'left';
      let lx = x + gutter + pad;
      for (const tok of lines[i]) {
        if (used >= shown) break;
        const text = tok.text.slice(0, Math.max(0, shown - used));
        ctx.fillStyle = color(th[tok.k] ?? th.text);
        ctx.fillText(text, lx, by);
        lx += ctx.measureText(text).width;
        used += text.length;
        cx = lx; cy = by + dy;
      }
      ctx.restore();
      if (used >= shown) break;
      used += 1;                                          // the newline
      cx = x + gutter + pad; cy = by + lh;
    }
    if (mode === 'type') {
      const total = lines.reduce((n, l) => n + l.reduce((m, t) => m + t.text.length, 0), 0) + lines.length - 1;
      if (shown < total + p.cps) {
        if (Math.floor(lt * 2.5) % 2 === 0 || shown < total) {
          ctx.fillStyle = color(th.fn);
          ctx.fillRect(cx + 2, cy - fs * 0.78, fs * 0.55, fs * 0.95);
        }
        animating = true;
      }
    }
    if (animating || (focusT && env.t - focusT.start < settle('snappy') && env.t > focusT.start)) env.animating();
    env.box({ kind: 'box', x, y, w, h });
    env.box({ kind: 'text', role: 'code', x: x + gutter + pad, y: top + pad, w: w - gutter - pad * 2, h: lines.length * lh, fg: color(th.text), bg: color(th.bg), size: fs, text: p.code.slice(0, 80), settled: !animating });
  },
  events(clip, env) {
    const p = env.props;
    const mode = p.reveal === 'type' && !p.typewriter ? 'none' : p.reveal;
    const out = [];
    const { lines } = prepared(p);
    if (mode === 'lines') {
      lineSchedule(clip, p, lines.length, env.beat, env.fps).forEach((l, i) => {
        out.push({ kind: 'hit', t: l.hit, sound: 'tick', gain_db: -12, pitch: i });
        if (i === 0) out.push({ kind: 'motion', role: 'code-lines', start: l.start, peak: l.start + peak('snappy'), settle: l.start + settle('snappy'), preset: 'snappy' });
      });
    } else if (mode === 'type') {
      let idx = 0;
      for (const line of String(p.code).split('\n')) {
        if (line.trim()) out.push({ kind: 'cue', t: clip.start + idx / p.cps, sound: 'tick', gain_db: -18 });
        idx += line.length + 1;
      }
    }
    if (parseRanges(p.focus).size) {
      const f = landOnBeat(clip.start, p.focus_beat, 'snappy', env.beat, env.fps);
      out.push({ kind: 'hit', t: f.hit, sound: 'pop', gain_db: -10 });
    }
    return out;
  },
});
