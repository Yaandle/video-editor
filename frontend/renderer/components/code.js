// code — a terminal/editor window with syntax colouring and a deterministic
// typewriter. Tokenizer ported from vidkit canvas.js (tokenizeCode); window
// restyled as a brutal panel: ink border, hard shadow, lime title bar.

import { register } from '../registry.js';
import { color, border, shadow as shadowTok, unit, family } from '../tokens.js';
import { box } from '../draw.js';

const KEYWORDS = {
  python: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield',
  js: 'await break case catch class const continue default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while yield null true false undefined',
  c: 'auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while include define bool true false',
};

const THEMES = {
  paper: { bg: 'white', text: 'ink', comment: 'ink-soft', keyword: 'orange', string: 'cobalt', number: 'orange', fn: 'cobalt', gutter: 'paper-deep', title: 'lime' },
  ink:   { bg: 'ink', text: 'paper', comment: '#9A968C', keyword: 'lime', string: '#8FA2FF', number: 'orange', fn: 'lime', gutter: '#262523', title: 'lime' },
};

export function tokenize(code, lang) {
  const kw = new Set((KEYWORDS[lang] ?? KEYWORDS.python).split(' '));
  const rules = [
    [/(#|\/\/)[^\n]*/g, 'comment'],
    [/"""[\s\S]*?"""|'''[\s\S]*?'''/g, 'string'],
    [/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, 'string'],
    [/\b(0x[0-9a-fA-F]+|\d+\.\d+|\d+)\b/g, 'number'],
    [/\b[A-Za-z_][A-Za-z0-9_]*(?=\s*\()/g, 'fn'],
    [/\b[A-Za-z_][A-Za-z0-9_]*\b/g, 'word'],
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
  for (const sp of spans) {
    if (sp.s < cur) continue;
    if (sp.s > cur) out.push({ text: code.slice(cur, sp.s), k: 'text' });
    out.push({ text: code.slice(sp.s, sp.e), k: sp.k });
    cur = sp.e;
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

const CACHE = new Map();

register({
  type: 'code',
  kind: 'component',
  label: 'Code window',
  category: 'Text',
  description: 'Syntax-coloured code in a brutal window, typed in at a fixed rate.',
  duration: 6,
  schema: {
    code: { type: 'text', default: 'def snap(t, bpm=120, fps=30):\n    step = 60 / bpm\n    return round(t / step) * step', label: 'Code', multiline: true, maxLength: 4000 },
    language: { type: 'enum', options: ['python', 'js', 'c'], default: 'python', label: 'Language' },
    title: { type: 'text', default: 'beatgrid.py', label: 'Title' },
    theme: { type: 'enum', options: ['paper', 'ink'], default: 'ink', label: 'Theme' },
    width: { type: 'number', min: 0.2, max: 1, step: 0.01, default: 0.62, label: 'Width (frame)' },
    typewriter: { type: 'bool', default: true, label: 'Type it in' },
    cps: { type: 'number', min: 2, max: 400, step: 1, default: 45, label: 'Chars per second' },
    font_px: { type: 'number', min: 8, max: 80, step: 1, default: 30, label: 'Code size px' },
  },
  label: (clip) => `code · ${clip.props?.title ?? ''}`,
  render(ctx, clip, lt, env) {
    const p = env.props;
    const u = unit(env.frame);
    const th = THEMES[p.theme] ?? THEMES.ink;
    const key = `${p.code}|${p.language}`;
    if (!CACHE.has(key)) CACHE.set(key, tokenize(p.code, p.language));
    const lines = CACHE.get(key);
    const fs = p.font_px * u;
    const lh = Math.round(fs * 1.5);
    const titleH = Math.round(fs * 1.9);
    const pad = fs * 0.9;
    const gutter = fs * 2.6;
    const w = p.width * env.frame.w * env.xf.sx;
    const h = titleH + pad * 2 + lines.length * lh;
    const x = env.anchor.x - w / 2, y = env.anchor.y - h / 2;
    const bw = border(env.frame);
    box(ctx, x, y, w, h, { fill: color(th.bg), stroke: color('ink'), strokeW: bw, shadow: shadowTok(env.frame) });
    ctx.fillStyle = color(th.title);
    ctx.fillRect(x + bw, y + bw, w - bw * 2, titleH - bw);
    ctx.fillStyle = color('ink');
    ctx.fillRect(x, y + titleH - bw, w, bw);
    ctx.font = `700 ${Math.round(fs * 0.8)}px "${family('mono-bold')}"`;
    ctx.textBaseline = 'middle';
    ctx.fillText(p.title, x + pad, y + titleH / 2);
    for (let i = 0; i < 3; i++) {                         // window controls as squares
      const s = fs * 0.55;
      ctx.fillRect(x + w - pad - (i + 1) * s * 1.7, y + titleH / 2 - s / 2, s, s);
    }
    ctx.fillStyle = color(th.gutter);
    ctx.fillRect(x + bw, y + titleH, gutter, h - titleH - bw);
    const shown = p.typewriter ? Math.floor(Math.max(0, lt) * p.cps) : Infinity;
    let used = 0, cx = 0, cy = 0;
    ctx.textBaseline = 'alphabetic';
    const codeFont = `${Math.round(fs)}px "${family('code')}"`;
    for (let i = 0; i < lines.length; i++) {
      const by = y + titleH + pad + i * lh + fs * 0.8;
      ctx.font = codeFont;
      ctx.fillStyle = color(th.comment);
      ctx.textAlign = 'right';
      ctx.fillText(String(i + 1), x + gutter - fs * 0.5, by);
      ctx.textAlign = 'left';
      let lx = x + gutter + pad;
      for (const tok of lines[i]) {
        if (used >= shown) break;
        const text = tok.text.slice(0, Math.max(0, shown - used));
        ctx.fillStyle = color(th[tok.k] ?? th.text);
        ctx.fillText(text, lx, by);
        lx += ctx.measureText(text).width;
        used += text.length;
        cx = lx; cy = by;
      }
      if (used >= shown) break;
      used += 1;                                          // the newline
      cx = x + gutter + pad; cy = by + lh;
    }
    const total = p.code.length;
    if (p.typewriter && shown < total + p.cps) {
      if (Math.floor(lt * 2.5) % 2 === 0 || shown < total) {
        ctx.fillStyle = color(th.fn);
        ctx.fillRect(cx + 2, cy - fs * 0.78, fs * 0.55, fs * 0.95);
      }
      env.animating();
    }
    env.box({ kind: 'box', x, y, w, h });
    env.box({ kind: 'text', role: 'code', x: x + gutter + pad, y: y + titleH + pad, w: w - gutter - pad * 2, h: lines.length * lh, fg: color(th.text), bg: color(th.bg), size: fs, text: p.code.slice(0, 80) });
  },
  events(clip, env) {
    const p = env.props;
    if (!p.typewriter) return [];
    const out = [];
    let idx = 0;
    for (const line of p.code.split('\n')) {
      if (line.trim()) out.push({ kind: 'cue', t: clip.start + idx / p.cps, sound: 'tick', gain_db: -18 });
      idx += line.length + 1;
    }
    return out;
  },
});
