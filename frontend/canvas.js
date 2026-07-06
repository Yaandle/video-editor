// canvas.js — HTML5 Canvas port of CanvasWidget
import { THEMES, TRACK_COLOURS } from './app.js';



// ── Syntax tokenizer (ported from CodePreviewWidget._colorize_code) ────────────
const PY_KEYWORDS = new Set([
  'False','None','True','and','as','assert','async','await','break','class',
  'continue','def','del','elif','else','except','finally','for','from','global',
  'if','import','in','is','lambda','nonlocal','not','or','pass','raise','return',
  'try','while','with','yield'
]);

function tokenizeCode(code, theme) {
  // Same precedence as _colorize_code: comments, strings, numbers, keywords, functions, operators, then plain identifiers.
  const rules = [
    { re: /#[^\n]*/g,                                    color: theme.comment  ?? '#6B7280' },
    { re: /"""(?:[^"\\]|\\.|\n)*?"""/g,                  color: theme.string   ?? '#16A34A' },
    { re: /'''(?:[^'\\]|\\.|\n)*?'''/g,                  color: theme.string   ?? '#16A34A' },
    { re: /"(?:[^"\\]|\\.)*?"/g,                         color: theme.string   ?? '#16A34A' },
    { re: /'(?:[^'\\]|\\.)*?'/g,                         color: theme.string   ?? '#16A34A' },
    { re: /\b(0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.\d+|\d+)\b/g, color: theme.number ?? '#DB2777' },
    { re: /\b[a-zA-Z_][a-zA-Z0-9_]*\b(?=\s*\()/g,        color: theme.function ?? '#2563EB', bold: true, guard: 'keyword' },
    { re: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g,                 color: theme.variable ?? '#7C3AED', guard: 'keyword' },
    { re: /[=+\-*/%<>!&|^~@]+/g,                         color: theme.operator ?? '#374151' },
  ];

  // Find every match across all rules, keep first-match-wins by scanning position order and rule priority.
  const spans = []; // {start, end, color, bold}
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(code))) {
      const text = m[0];
      if (rule.guard === 'keyword' && PY_KEYWORDS.has(text)) {
        spans.push({ start: m.index, end: m.index + text.length, color: theme.keyword ?? '#D97706', bold: true });
      } else {
        spans.push({ start: m.index, end: m.index + text.length, color: rule.color, bold: !!rule.bold });
      }
      if (m[0].length === 0) rule.re.lastIndex++;
    }
  }
  // Sort by start, then by span length descending so longer/more-specific matches win ties (e.g. triple-quote strings vs single-quote).
  spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const tokens = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start < cursor) continue; // already covered by a higher-priority span
    if (s.start > cursor) tokens.push({ text: code.slice(cursor, s.start), color: theme.text ?? '#1F2937', bold: false });
    tokens.push({ text: code.slice(s.start, s.end), color: s.color, bold: s.bold });
    cursor = s.end;
  }
  if (cursor < code.length) tokens.push({ text: code.slice(cursor), color: theme.text ?? '#1F2937', bold: false });
  return tokens;
}

function tokensToLines(tokens) {
  // Split the flat token stream into per-line token arrays, splitting any token that contains '\n'.
  const lines = [[]];
  for (const tok of tokens) {
    const parts = tok.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([]);
      if (parts[i].length) lines[lines.length - 1].push({ text: parts[i], color: tok.color, bold: tok.bold });
    }
  }
  return lines;
}

const Easing = {
  linear: t => t,
  easeOutCubic: t => 1 - Math.pow(1 - t, 3),
  easeOutExpo: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  easeOutBack: (t, overshoot = 1.7) => {
    const c1 = overshoot;
    const c3 = c1 + 1;
    const x = t - 1;
    return 1 + c3 * x * x * x + c1 * x * x;
  }
};

// aspect derived from project at paint time — see _canvasRect()
const MIN_SCALE      = 0.05;
const MAX_SCALE      = 4.0;
const HANDLE_SIZE    = 10;
const MIN_ZOOM        = 0.1;   // NEW
const MAX_ZOOM        = 4.0;   // NEW

const SNAP_POSITIONS = [
  [0.5,  0.12, 'top centre'],
  [0.5,  0.50, 'mid centre'],
  [0.5,  0.85, 'bottom centre'],
  [0.25, 0.12, 'top left'],
  [0.75, 0.12, 'top right'],
];
const SNAP_THRESHOLD = 0.04;

export class CanvasWidget {
  constructor(canvasEl, project) {
    this._el      = canvasEl;
    this._ctx     = canvasEl.getContext('2d');
    this.project  = project;
    this.playhead = 0.0;
    this._selectedId  = null;
    this._dragClip    = null;
    this._dragOffsetX = 0;
    this._dragOffsetY = 0;
    this._snapTarget  = null;
    this._mediaCache  = new Map();

    this._snapTarget  = null;
    this._mediaCache  = new Map();
    this._panY = 0;     
    this._zoom = 1.0;   
    this._panX = 0;     

    // Canvas pan-drag state (click+hold on empty space)
    this._isPanning     = false;
    this._panDragOrigin = null; // { mouseX, mouseY, panX, panY }


    // Resize state
    this._resizeHandle  = null;   // 'tl'|'tr'|'bl'|'br' | null
    this._resizeOrigin  = null;   // { mouseX, mouseY, scale, rectW, rectH, canvasRectH }
    this._drawnRects    = new Map(); // clipId → {x,y,w,h}

    this._bindEvents();
    this.resize();
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  setProject(p)     { this.project = p; this.redraw(); }
  setPlayhead(t)    { this.playhead = t; this.redraw(); }
  setSelectedId(id) { this._selectedId = id; this.redraw(); }
  redraw()          { this._paint(); }

  resize() {
    const frame = this._el.parentElement;
    this._el.width  = frame.clientWidth;
    this._el.height = frame.clientHeight;
    this.redraw();
  }

  // ── Geometry ────────────────────────────────────────────────────────────────
  _canvasRect() {
    const w      = this._el.width;
    const h      = this._el.height;
    const aspect = (this.project.canvas_w ?? 1080) / (this.project.canvas_h ?? 1920);
    const cw     = Math.min(w, h * aspect) | 0;
    const ch     = (cw / aspect) | 0;
    const x      = ((w - cw) / 2) | 0;
    const y      = ((h - ch) / 2) | 0;
    return { x, y, w: cw, h: ch };
  }

  _normToPx(nx, ny) {
    const r = this._canvasRect();
    return { x: r.x + nx * r.w | 0, y: r.y + ny * r.h | 0 };
  }

  _pxToNorm(px, py) {
    const r  = this._canvasRect();
    const nx = (px - r.x) / r.w;
    const ny = (py - r.y) / r.h;
    return { nx: Math.max(0, Math.min(1, nx)), ny: Math.max(0, Math.min(1, ny)) };
  }

  _toLogical(screenX, screenY) {
    return {
      x: (screenX - this._panX) / this._zoom,
      y: (screenY - this._panY) / this._zoom,
    };
  }

  _activeClips() {
    return this.project.clips
      .filter(c => c.start <= this.playhead && this.playhead < c.end())
      .sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0));
  }
  _clipRect(clip, r) {
    const pt   = this._normToPx(clip.x, clip.y);
    const maxW = (r.w * 0.88) | 0;
    return { x: pt.x - (maxW >> 1), y: pt.y - 14, w: maxW, h: 28 };
  }

  // ── Corner handle positions for a drawn rect ────────────────────────────────
  _handlePositions(rect) {
    return {
      tl: { x: rect.x,            y: rect.y },
      tr: { x: rect.x + rect.w,   y: rect.y },
      bl: { x: rect.x,            y: rect.y + rect.h },
      br: { x: rect.x + rect.w,   y: rect.y + rect.h },
    };
  }

  _hitHandle(px, py, rect) {
    const handles = this._handlePositions(rect);
    for (const [name, pt] of Object.entries(handles)) {
      if (Math.abs(px - pt.x) <= HANDLE_SIZE && Math.abs(py - pt.y) <= HANDLE_SIZE) {
        return name;
      }
    }
    return null;
  }

  // ── Painting ────────────────────────────────────────────────────────────────
  _paint() {
    this._drawnRects.clear();
    const ctx   = this._ctx;
    const el    = this._el;
    const r     = this._canvasRect();
    const theme = THEMES.dark;

    ctx.clearRect(0, 0, el.width, el.height);

    ctx.save();
    ctx.translate(this._panX, this._panY);
    ctx.scale(this._zoom, this._zoom);           
    


    // Canvas background
    ctx.fillStyle = theme.bg;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#505050';
    ctx.lineWidth   = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);

    // Snap guides
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(59,130,246,0.24)';
    ctx.lineWidth   = 1;
    const cx = r.x + (r.w >> 1);
    ctx.beginPath(); ctx.moveTo(cx, r.y); ctx.lineTo(cx, r.y + r.h); ctx.stroke();
    for (const frac of [1/3, 2/3]) {
      const gy = r.y + (r.h * frac) | 0;
      ctx.beginPath(); ctx.moveTo(r.x, gy); ctx.lineTo(r.x + r.w, gy); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Active snap highlight
    if (this._snapTarget) {
      const [sx, sy] = this._snapTarget;
      const pt = this._normToPx(sx, sy);
      ctx.strokeStyle = 'rgba(59,130,246,0.7)';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(r.x, pt.y); ctx.lineTo(r.x + r.w, pt.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pt.x, r.y); ctx.lineTo(pt.x, r.y + r.h); ctx.stroke();
    }

    for (const clip of this._activeClips()) {
        this._drawClip(ctx, clip, r);
      }

      if (this._selectedId) {
        const clip = this.project.clips.find(c => c.id === this._selectedId);
        if (clip) {
          if (clip.clip_type === 'image' || clip.clip_type === 'video' || clip.clip_type === 'code' || clip.clip_type === 'narration') {
            const drawn = this._drawnRects.get(clip.id);
            if (drawn) this._drawResizeOverlay(ctx, drawn);
          } else if (clip.track === 'text' || clip.track === 'visual') {
            const cr = this._clipRect(clip, r);
            ctx.strokeStyle = 'rgba(59,130,246,0.9)';
            ctx.lineWidth   = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(cr.x - 3, cr.y - 3, cr.w + 6, cr.h + 6);
            ctx.setLineDash([]);
          }
        }
      }

      ctx.restore();   // now runs every time, selection or not
  }

  _drawResizeOverlay(ctx, rect) {
    // Dashed selection border
    ctx.strokeStyle = 'rgba(59,130,246,0.9)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4);
    ctx.setLineDash([]);

    // Corner handles
    const handles = this._handlePositions(rect);
    for (const pt of Object.values(handles)) {
      ctx.fillStyle   = '#ffffff';
      ctx.strokeStyle = 'rgba(59,130,246,0.9)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.rect(pt.x - HANDLE_SIZE / 2, pt.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.fill();
      ctx.stroke();
    }
  }

  _drawClip(ctx, clip, r) {
    const theme = THEMES[clip.theme] ?? THEMES.dark;
    if (clip.track === 'audio') return;

    const pt   = this._normToPx(clip.x, clip.y);
    const maxW = (r.w * 0.88) | 0;

    if (clip.clip_type === 'narration') {
      const fontSize = Math.max(7, (r.w / 18) | 0);
      ctx.font         = `${fontSize}px Consolas, monospace`;
      ctx.fillStyle    = theme.text;
      ctx.textBaseline = 'top';

      const lineHeight = fontSize * 1.4;
      const layout = this._layoutNarrationText(ctx, clip.content, maxW, lineHeight);
      const elapsedMs = Math.max(0, this.playhead - clip.start) * 1000;

      if (clip.text_anim_style && clip.text_anim_style !== 'static') {
        this._renderNarrationAnimated(ctx, layout, pt.x, pt.y, elapsedMs, clip, theme);
      } else {
        ctx.textAlign = 'center';
        this._renderNarrationStatic(ctx, layout, pt.x, pt.y, theme);
      }

      const bx = pt.x - (maxW >> 1);
      const by = pt.y;
      const height = layout.lines.length * lineHeight;
      this._drawnRects.set(clip.id, { x: bx, y: by, w: maxW, h: height });
    }
    else if (clip.clip_type === 'code') {
        this._drawCodeTerminal(ctx, clip, r, pt, theme);
      }
    
    else if (clip.clip_type === 'graph') {
      const blockH = (r.h * 0.35) | 0;
      const blockW = (r.w * 0.88) | 0;
      const bx     = r.x + ((r.w - blockW) >> 1);
      const by     = pt.y - (blockH >> 1);
      ctx.fillStyle   = theme.bg;
      ctx.fillRect(bx, by, blockW, blockH);
      ctx.strokeStyle = theme.border;
      ctx.lineWidth   = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, blockW, blockH);
      this._drawGraphPreview(ctx, clip, bx, by, blockW, blockH, theme, r);
    }
    else if (clip.clip_type === 'image') {
      this._drawMedia(ctx, clip, r, pt);
    }
    else if (clip.clip_type === 'video') {
      this._drawMedia(ctx, clip, r, pt);
    }
  }

  _drawCodeTerminal(ctx, clip, r, pt, theme) {
    const blockW    = (r.w * 0.92) | 0;
    const maxBlockH = Math.min((r.h * 0.55) | 0, 340);
    const bx        = r.x + ((r.w - blockW) >> 1);
    const titleH    = 28;
    const promptH   = clip.terminal_prompt ? 26 : 0;
    const padTop    = 10;
    const padBottom = 10;
    const padX      = 12;

    const lines = tokensToLines(tokenizeCode(clip.content ?? '', theme));

    // Auto-fit: shrink font until content height fits within maxBlockH, down to a minimum size.
    let fontSize = Math.max(9, (r.w / 46) | 0);
    const minFontSize = 7;
    let lineH, gutterW, contentH;

    do {
      lineH    = fontSize * 1.55;
      gutterW  = Math.max(28, fontSize * 2.4) | 0;
      contentH = lines.length * lineH + padTop + padBottom;
      if (titleH + promptH + contentH <= maxBlockH || fontSize <= minFontSize) break;
      fontSize -= 1;
    } while (true);

    const blockH = Math.min(maxBlockH, titleH + promptH + contentH);
    const by     = pt.y - (blockH >> 1);

    // Register actual drawn bounds so selection/resize overlay hugs the window border,
    // not a fallback text-label box.
    this._drawnRects.set(clip.id, { x: bx, y: by, w: blockW, h: blockH });

    // Outer window
    ctx.fillStyle   = theme.bg ?? '#1e1e1e';
    ctx.fillRect(bx, by, blockW, blockH);
    ctx.strokeStyle = theme.border ?? '#404040';
    ctx.lineWidth   = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, blockW, blockH);

    // Title bar
    ctx.fillStyle = theme.titlebar ?? this._shade(theme.bg, 1.15);
    ctx.fillRect(bx, by, blockW, titleH);
    ctx.strokeStyle = theme.border ?? '#404040';
    ctx.beginPath(); ctx.moveTo(bx, by + titleH + 0.5); ctx.lineTo(bx + blockW, by + titleH + 0.5); ctx.stroke();

    // Window controls: minimize (line), maximize (square), close (x) — right-aligned
    const iconColor = theme.comment ?? '#9ca3af';
    const iconSize  = 9;
    const iconGap   = 18;
    const iconCY    = by + titleH / 2;
    const rightPad  = 16;
    const closeCX = bx + blockW - rightPad - iconSize / 2;
    const maxCX   = closeCX - iconGap;
    const minCX   = maxCX - iconGap;

    ctx.strokeStyle = iconColor;
    ctx.lineWidth   = 1.3;
    ctx.lineCap     = 'round';

    // minimize — horizontal line
    ctx.beginPath();
    ctx.moveTo(minCX - iconSize / 2, iconCY);
    ctx.lineTo(minCX + iconSize / 2, iconCY);
    ctx.stroke();

    // maximize — square outline
    ctx.strokeRect(maxCX - iconSize / 2, iconCY - iconSize / 2, iconSize, iconSize);

    // close — x
    ctx.beginPath();
    ctx.moveTo(closeCX - iconSize / 2, iconCY - iconSize / 2);
    ctx.lineTo(closeCX + iconSize / 2, iconCY + iconSize / 2);
    ctx.moveTo(closeCX + iconSize / 2, iconCY - iconSize / 2);
    ctx.lineTo(closeCX - iconSize / 2, iconCY + iconSize / 2);
    ctx.stroke();

    if (clip.terminal_title) {
      ctx.fillStyle = theme.comment ?? '#9ca3af';
      ctx.font = `${fontSize}px Consolas, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(clip.terminal_title, bx + blockW / 2, by + titleH / 2);
    }

    // Prompt breadcrumb line
    let contentTop = by + titleH;
    if (clip.terminal_prompt) {
      ctx.fillStyle = theme.bg ?? '#1e1e1e';
      ctx.fillRect(bx, contentTop, blockW, promptH);
      ctx.font = `${fontSize}px Consolas, monospace`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = theme.function ?? '#4ec9b0';
      ctx.fillText(clip.terminal_prompt, bx + padX, contentTop + promptH / 2);
      contentTop += promptH;
    }

    // Gutter divider — faded vertical line separating line numbers from code
    ctx.strokeStyle = theme.border ? this._withAlpha(theme.border, 0.35) : 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(bx + gutterW + 4.5, contentTop);
    ctx.lineTo(bx + gutterW + 4.5, by + blockH);
    ctx.stroke();

    // Code area, clipped so long lines/many lines don't spill the window
    ctx.save();
    ctx.beginPath(); ctx.rect(bx, contentTop, blockW, by + blockH - contentTop); ctx.clip();

    ctx.font = `${fontSize}px Consolas, monospace`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';

    const codeStartY = contentTop + padTop;
    let visibleLines = lines.length;
    if (clip.anim_mode === 'typewriter') {
      const elapsed     = Math.max(0, this.playhead - clip.start);
      const charsPerSec = clip.type_speed ?? 40;
      const totalChars  = elapsed * charsPerSec;
      visibleLines = this._typewriterClip(lines, totalChars, ctx, bx, gutterW, padX, codeStartY, lineH, theme);
    } else {
      for (let i = 0; i < lines.length; i++) {
        this._drawCodeLine(ctx, lines[i], i, bx, gutterW, padX, codeStartY, lineH, theme);
      }
    }
    ctx.restore();

    // Blinking cursor after the last visible line (typewriter mode, or static with cursor flag)
    if (clip.show_cursor !== false) {
      const blinkOn = Math.floor(this.playhead * 2) % 2 === 0;
      if (blinkOn) {
        const cursorLine = Math.min(visibleLines, lines.length - 1);
        const cy = codeStartY + Math.max(0, cursorLine) * lineH;
        ctx.fillStyle = theme.text ?? '#d4d4d4';
        ctx.fillRect(bx + gutterW + padX, cy, fontSize * 0.55, fontSize * 1.15);
      }
    }
  }

  _withAlpha(hex, alpha) {
    if (!hex || hex[0] !== '#') return hex;
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  
  _drawCodeLine(ctx, tokens, lineIdx, bx, gutterW, padX, startY, lineH, theme) {
    const y = startY + lineIdx * lineH;
    // Gutter
    ctx.fillStyle = theme.comment ?? '#6b7280';
    ctx.textAlign = 'right';
    ctx.fillText(String(lineIdx + 1), bx + gutterW - 10, y);
    ctx.textAlign = 'left';
    // Tokens
    let x = bx + gutterW + padX;
    for (const tok of tokens) {
      ctx.font = `${tok.bold ? 'bold ' : ''}${ctx.font.match(/[\d.]+px [^,]+/)?.[0] ?? '12px Consolas'}`;
      ctx.fillStyle = tok.color;
      ctx.fillText(tok.text, x, y);
      x += ctx.measureText(tok.text).width;
    }
  }

  _typewriterClip(lines, totalChars, ctx, bx, gutterW, padX, startY, lineH, theme) {
    let remaining = Math.floor(totalChars);
    for (let i = 0; i < lines.length; i++) {
      if (remaining <= 0) return i;
      const lineTokens = [];
      let used = 0;
      for (const tok of lines[i]) {
        if (used >= remaining) break;
        const take = Math.min(tok.text.length, remaining - used);
        lineTokens.push({ text: tok.text.slice(0, take), color: tok.color, bold: tok.bold });
        used += take;
        if (used >= remaining) break;
      }
      this._drawCodeLine(ctx, lineTokens, i, bx, gutterW, padX, startY, lineH, theme);
      remaining -= (lines[i].reduce((s, t) => s + t.text.length, 0) + 1); // +1 for the newline
    }
    return lines.length - 1;
  }

  _layoutNarrationText(ctx, text, maxWidth, lineHeight) {
    const rawWords = text.split(' ');
    const spaceWidth = ctx.measureText(' ').width;
    const lines = [];
    let currentLine = [];
    let currentWidth = 0;
    let gWord = 0;
    let gChar = 0;

    for (const word of rawWords) {
      const width = ctx.measureText(word).width;
      if (currentLine.length && currentWidth + spaceWidth + width > maxWidth) {
        lines.push(currentLine);
        currentLine = [];
        currentWidth = 0;
      }

      const chars = [];
      let cx = 0;
      for (const ch of word) {
        const cw = ctx.measureText(ch).width;
        chars.push({ char: ch, x: cx, width: cw, globalIndex: gChar++ });
        cx += cw;
      }

      currentLine.push({ text: word, width, chars, globalIndex: gWord++ });
      currentWidth += (currentLine.length > 1 ? spaceWidth : 0) + width;
    }
    if (currentLine.length) lines.push(currentLine);

    const outLines = lines.map((line, li) => {
      let x = 0;
      const words = line.map((word, wi) => {
        if (wi > 0) x += spaceWidth;
        const result = { ...word, x };
        x += word.width;
        return result;
      });
      return { words, y: li * lineHeight, lineWidth: x };
    });

    return {
      lines: outLines,
      totalWords: outLines.reduce((sum, line) => sum + line.words.length, 0),
      totalChars: gChar,
      lineHeight,
    };
  }

  _renderNarrationStatic(ctx, layout, ox, oy, theme) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.text;

    for (const line of layout.lines) {
      const lineOx = ox - line.lineWidth / 2;
      for (const word of line.words) {
        ctx.fillText(word.text, lineOx + word.x, oy + line.y);
      }
    }

    ctx.restore();
  }

  _renderNarrationAnimated(ctx, layout, ox, oy, elapsedMs, clip, theme) {
    if (clip.text_anim_style === 'typewriter') {
      this._renderNarrationTypewriter(ctx, layout, ox, oy, elapsedMs, clip, theme);
    } else if (clip.text_anim_style === 'wordblurin') {
      this._renderNarrationWordBlurIn(ctx, layout, ox, oy, elapsedMs, clip, theme);
    } else if (clip.text_anim_style === 'linescan') {
      this._renderNarrationLineScan(ctx, layout, ox, oy, elapsedMs, clip, theme);
    } else {
      this._renderNarrationStatic(ctx, layout, ox, oy, theme);
    }
  }

  _renderNarrationTypewriter(ctx, layout, ox, oy, elapsedMs, clip, theme) {
    const msPerChar = 1000 / (clip.text_chars_per_second ?? 26);
    const popMs = clip.text_pop_duration_ms ?? 90;
    let lastX = ox;
    let lastY = oy;
    const lastH = layout.lineHeight * 0.78;
    let allDone = true;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.text;

    for (const line of layout.lines) {
      const lineOx = ox - line.lineWidth / 2;
      for (const word of line.words) {
        for (const ch of word.chars) {
          const revealAt = ch.globalIndex * msPerChar;
          const localT = elapsedMs - revealAt;
          if (localT < 0) {
            allDone = false;
            continue;
          }
          const popT = Math.min(1, localT / popMs);
          const scale = 0.4 + 0.6 * Math.max(0, Easing.easeOutBack(popT, 1.2));
          const alpha = Math.min(1, localT / (popMs * 0.6));
          ctx.save();
          ctx.globalAlpha = alpha;
          const cx = lineOx + word.x + ch.x + ch.width / 2;
          const cy = oy + line.y;
          ctx.translate(cx, cy);
          ctx.scale(scale, scale);
          ctx.fillText(ch.char, -ch.width / 2, 0);
          ctx.restore();
          lastX = lineOx + word.x + ch.x + ch.width;
          lastY = oy + line.y;
        }
      }
    }

    if (!allDone) {
      const blinkOn = Math.floor(this.playhead * 2) % 2 === 0;
      if (blinkOn) {
        ctx.fillStyle = theme.text ?? '#d4d4d4';
        ctx.fillRect(lastX + 2, lastY, 3, lastH);
      }
    }

    ctx.restore();
  }

  _renderNarrationWordBlurIn(ctx, layout, ox, oy, elapsedMs, clip, theme) {
    const stagger = clip.text_stagger_ms ?? 60;
    const dur = clip.text_duration_ms ?? 550;
    const maxBlur = clip.text_max_blur ?? 14;
    const rise = clip.text_rise_distance ?? 22;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.text;

    for (const line of layout.lines) {
      const lineOx = ox - line.lineWidth / 2;
      for (const word of line.words) {
        const startTime = word.globalIndex * stagger;
        const localT = elapsedMs - startTime;
        if (localT < 0) continue;
        const t = Math.max(0, Math.min(1, localT / dur));
        const clearT = Easing.easeOutCubic(Math.min(1, t * 1.6));
        const springT = Easing.easeOutBack(t, 1.4);
        const blur = maxBlur * (1 - clearT);
        const alpha = Math.min(1, t * 2.2);
        const yOffset = rise * (1 - springT);
        const scale = 0.85 + 0.15 * springT;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.filter = blur > 0.3 ? 'blur(' + blur.toFixed(1) + 'px)' : 'none';
        const wx = lineOx + word.x + word.width / 2;
        const wy = oy + line.y + yOffset;
        ctx.translate(wx, wy);
        ctx.scale(scale, scale);
        ctx.fillText(word.text, -word.width / 2, 0);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  _renderNarrationLineScan(ctx, layout, ox, oy, elapsedMs, clip, theme) {
    const dur = clip.text_duration_ms ?? 550;
    const stagger = clip.text_line_stagger_ms ?? 140;
    const slideDist = clip.text_slide_distance ?? 90;
    const sweepWidth = clip.text_sweep_width ?? 140;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.text;

    for (let li = 0; li < layout.lines.length; li++) {
      const line = layout.lines[li];
      const startTime = li * stagger;
      const localT = elapsedMs - startTime;
      if (localT < 0) continue;
      const t = Math.max(0, Math.min(1, localT / dur));
      const eased = Easing.easeOutExpo(t);
      const xOffset = -slideDist * (1 - eased);
      const alpha = Math.min(1, t * 3);
      const lineX = ox - line.lineWidth / 2 + xOffset;
      const lineText = line.words.map(w => w.text).join(' ');

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillText(lineText, lineX, oy + line.y);
      ctx.restore();

      if (t < 0.9) {
        const sweepT = Easing.easeOutCubic(Math.min(1, t / 0.75));
        const sweepX = -sweepWidth + sweepT * (line.lineWidth + sweepWidth * 2);
        const off = document.createElement('canvas');
        off.width = Math.ceil(line.lineWidth + 20);
        off.height = Math.ceil(layout.lineHeight);
        const octx = off.getContext('2d');
        octx.font = ctx.font;
        octx.textBaseline = ctx.textBaseline;
        octx.fillStyle = theme.text;
        octx.fillText(lineText, 0, off.height * 0.7);
        octx.globalCompositeOperation = 'source-atop';
        const grad = octx.createLinearGradient(sweepX - sweepWidth / 2, 0, sweepX + sweepWidth / 2, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.5, theme.text ?? '#ffffff');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        octx.fillStyle = grad;
        octx.fillRect(0, 0, off.width, off.height);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(off, lineX, oy + line.y - off.height * 0.7);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  _shade(hex, factor) {
    if (!hex || hex[0] !== '#') return hex;
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((n >> 16) & 255) * factor) | 0;
    const g = Math.min(255, ((n >> 8) & 255) * factor) | 0;
    const b = Math.min(255, (n & 255) * factor) | 0;
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  _drawMedia(ctx, clip, r, pt) {
    const theme = THEMES[clip.theme] ?? THEMES.dark;
    const url   = clip.code_file;

    if (!url) {
      this._drawPlaceholder(ctx, '[no media]', pt, r, theme);
      return;
    }

    const entry = this._loadMedia(url);

    if (!entry.loaded) {
      this._drawPlaceholder(ctx, '[loading…]', pt, r, theme);
      const maxW = (r.w * 0.88) | 0;
      const maxH = (r.h * 0.50) | 0;
      this._drawnRects.set(clip.id, {
        x: pt.x - (maxW >> 1),
        y: pt.y - (maxH >> 1),
        w: maxW,
        h: maxH,
      });
      return;
    }

    const el   = entry.el;
    const natW = el.naturalWidth  || el.videoWidth  || 1;
    const natH = el.naturalHeight || el.videoHeight || 1;

    if (clip.clip_type === 'video') {
      const target = Math.max(0, this.playhead - clip.start);
      if (Math.abs(el.currentTime - target) > 0.15) el.currentTime = target;
    }

    const scale    = clip.scale ?? 1.0;
    const maxW     = (r.w * 0.88) | 0;
    const maxH     = (r.h * 0.80) | 0;
    const fitScale = Math.min(maxW / natW, maxH / natH, 1);
    const dw       = (natW * fitScale * scale) | 0;
    const dh       = (natH * fitScale * scale) | 0;
    const dx       = pt.x - (dw >> 1);
    const dy       = pt.y - (dh >> 1);

    ctx.drawImage(el, dx, dy, dw, dh);

    // Always update — this is what the handles and hit-test read
    this._drawnRects.set(clip.id, { x: dx, y: dy, w: dw, h: dh });
  }

  _drawPlaceholder(ctx, text, pt, r, theme) {
    ctx.fillStyle    = theme.comment ?? '#888';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `${Math.max(6, r.w / 28 | 0)}px Consolas, monospace`;
    ctx.fillText(text, pt.x, pt.y);
  }

  _drawWrappedText(ctx, text, cx, y, maxW, lineH) {
    const words = text.split(' ');
    let line = '';
    let curY = y;
    const startY = y;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, cx, curY);
        line = word;
        curY += lineH;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, cx, curY);
    
    // Return bounds of rendered text for bounding box calculations
    const endY = curY + lineH; // full line height for last line
    return { startY, endY, height: endY - startY };
  }

  _drawGraphPreview(ctx, clip, bx, by, bw, bh, theme, r) {
    const pairs = [];
    for (const token of clip.graph_data.split(',')) {
      const t     = token.trim();
      const colon = t.indexOf(':');
      if (colon >= 0) {
        const label = t.slice(0, colon).trim();
        const val   = parseFloat(t.slice(colon + 1).trim());
        if (!isNaN(val)) pairs.push([label, val]);
      }
    }
    if (!pairs.length) return;

    const maxVal    = Math.max(...pairs.map(p => p[1])) || 1;
    const n         = pairs.length;
    const pad       = 12;
    const barAreaW  = bw - pad * 2;
    const barW      = Math.max(4, (barAreaW / n) - 4 | 0);
    const barAreaH  = bh - pad * 3;
    const barColor  = theme.function ?? '#2563EB';
    const labelColor = theme.comment ?? '#6B7280';
    const fontSize  = Math.max(5, (bw / 28) | 0);
    ctx.font = `${fontSize}px Consolas, monospace`;

    for (let i = 0; i < pairs.length; i++) {
      const [label, val] = pairs[i];
      const barH = ((val / maxVal) * barAreaH) | 0;
      const bxi  = bx + pad + i * (barW + 4);
      const byi  = by + bh - pad - barH;
      ctx.fillStyle    = barColor;
      ctx.fillRect(bxi, byi, barW, barH);
      ctx.fillStyle    = labelColor;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label.slice(0, 4), bxi, by + bh - 2);
    }
  }

  // ── Mouse interaction ────────────────────────────────────────────────────────
  _bindEvents() {
    const el = this._el;
    el.addEventListener('mousedown',  e => this._onMouseDown(e));
    el.addEventListener('mousemove',  e => this._onMouseMove(e));
    el.addEventListener('mouseup',    e => this._onMouseUp(e));
    el.addEventListener('mouseleave', e => this._onMouseUp(e));
    el.addEventListener('wheel', e => this._onWheel(e), { passive: false }); 
  }

  _getPos(e) {
    const rect = this._el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _clipAt(px, py) {
    const r     = this._canvasRect();
    const clips = this._activeClips();

    for (let i = clips.length - 1; i >= 0; i--) {
      const clip = clips[i];
      if (clip.track === 'audio') continue;

      if (clip.clip_type === 'image' || clip.clip_type === 'video') {
        const drawn = this._drawnRects.get(clip.id);
        if (drawn) {
          if (px >= drawn.x && px <= drawn.x + drawn.w &&
              py >= drawn.y && py <= drawn.y + drawn.h) return clip;
          continue;
        }
        const pt = this._normToPx(clip.x, clip.y);
        const fallbackR = 60;
        if (Math.abs(px - pt.x) < fallbackR && Math.abs(py - pt.y) < fallbackR) return clip;
        continue;
      }

      const cr = this._clipRect(clip, r);
      if (px >= cr.x - 6 && px <= cr.x + cr.w + 6 &&
          py >= cr.y - 6 && py <= cr.y + cr.h + 6) return clip;
    }
    return null;
  }

  _onWheel(e) {
    e.preventDefault();
    const raw = this._getPos(e);
    const oldZoom = this._zoom;
    const factor  = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor));
    if (newZoom === oldZoom) return;

    // Keep the logical point under the cursor fixed on screen.
    const logicalX = (raw.x - this._panX) / oldZoom;
    const logicalY = (raw.y - this._panY) / oldZoom;
    this._panX = raw.x - logicalX * newZoom;
    this._panY = raw.y - logicalY * newZoom;
    this._zoom = newZoom;

    this.redraw();
  }


  _onMouseDown(e) {
    if (e.button !== 0) return;
    const raw = this._getPos(e);
    const pos = this._toLogical(raw.x, raw.y);

    // Check for resize handle on selected image/video/code/narration first
    if (this._selectedId) {
      const clip = this.project.clips.find(c => c.id === this._selectedId);
      if (clip && (clip.clip_type === 'image' || clip.clip_type === 'video' || clip.clip_type === 'code' || clip.clip_type === 'narration')) {
        const drawn = this._drawnRects.get(clip.id);
        if (drawn) {
          const handle = this._hitHandle(pos.x, pos.y, drawn);
          if (handle) {
            this._resizeHandle = handle;
            this._resizeOrigin = {
              mouseX:   pos.x,
              mouseY:   pos.y,
              scale:    clip.scale ?? 1.0,
              rectW:    drawn.w,
              rectH:    drawn.h,
              canvasH:  this._canvasRect().h,
            };
            this._el.style.cursor = this._resizeCursor(handle);
            return;
          }
        }
      }
    }

    // Normal clip select / drag
    const clip = this._clipAt(pos.x, pos.y);
    if (clip) {
      this._selectedId  = clip.id;
      this._dragClip    = clip;
      const pt          = this._normToPx(clip.x, clip.y);
      this._dragOffsetX = pos.x - pt.x;
      this._dragOffsetY = pos.y - pt.y;
      this._el.style.cursor = 'move';
      this._el.dispatchEvent(new CustomEvent('canvas:select', { bubbles: true, detail: { id: clip.id } }));
    } else {
      this._selectedId = null;
      this._dragClip   = null;
      this._el.dispatchEvent(new CustomEvent('canvas:deselect', { bubbles: true }));

      // Nothing hit — start panning the canvas
      this._isPanning     = true;
      this._panDragOrigin = { mouseX: raw.x, mouseY: raw.y, panX: this._panX, panY: this._panY };
      this._el.style.cursor = 'grabbing';
    }
    this.redraw();
  }

  _onMouseMove(e) {
    const raw = this._getPos(e); 
    const pos = this._toLogical(raw.x, raw.y);
    
    // ── Resize drag ────────────────────────────────────────────────────────────
    if (this._resizeHandle && (e.buttons & 1)) {
      const clip = this.project.clips.find(c => c.id === this._selectedId);
      if (clip) {
        const o    = this._resizeOrigin;
        const dx   = pos.x - o.mouseX;
        const dy   = pos.y - o.mouseY;

        // Use whichever axis moved more, sign depends on corner
        const sign = (this._resizeHandle === 'br' || this._resizeHandle === 'tr') ? 1 : -1;
        const delta = Math.abs(dx) > Math.abs(dy) ? dx * sign : dy * sign;

        // Convert pixel delta → scale delta relative to the fit-size rect
        const refDim   = Math.max(o.rectW, o.rectH);
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE,
          o.scale + (delta / refDim) * o.scale
        ));

        clip.scale = parseFloat(newScale.toFixed(3));
        this._el.dispatchEvent(new CustomEvent('canvas:clipresized', {
          bubbles: true, detail: { id: clip.id, scale: clip.scale }
        }));
        this.redraw();
      }
      return;
    }

    // ── Pan drag ───────────────────────────────────────────────────────────────
    if (this._isPanning && (e.buttons & 1)) {
      const raw = this._getPos(e);
      const o   = this._panDragOrigin;
      this._panX = o.panX + (raw.x - o.mouseX);
      this._panY = o.panY + (raw.y - o.mouseY);
      this.redraw();
      return;
    }

    // ── Move drag ──────────────────────────────────────────────────────────────
    if (this._dragClip && (e.buttons & 1)) {
      const rawX  = pos.x - this._dragOffsetX;
      const rawY  = pos.y - this._dragOffsetY;
      let { nx, ny } = this._pxToNorm(rawX, rawY);

      this._snapTarget = null;
      for (const [sx, sy, label] of SNAP_POSITIONS) {
        if (Math.abs(nx - sx) < SNAP_THRESHOLD && Math.abs(ny - sy) < SNAP_THRESHOLD) {
          nx = sx; ny = sy;
          this._snapTarget = [sx, sy, label];
          break;
        }
      }
      this._dragClip.x = nx;
      this._dragClip.y = ny;
      this._el.dispatchEvent(new CustomEvent('canvas:clipmoved', {
        bubbles: true, detail: { id: this._dragClip.id, nx, ny }
      }));
      this.redraw();
      return;
    }

    // ── Cursor feedback ────────────────────────────────────────────────────────
    if (this._selectedId) {
      const clip = this.project.clips.find(c => c.id === this._selectedId);
      if (clip && (clip.clip_type === 'image' || clip.clip_type === 'video')) {
        const drawn = this._drawnRects.get(clip.id);
        if (drawn) {
          const handle = this._hitHandle(pos.x, pos.y, drawn);
          if (handle) {
            this._el.style.cursor = this._resizeCursor(handle);
            return;
          }
        }
      }
    }
    const clip = this._clipAt(pos.x, pos.y);
    this._el.style.cursor = clip ? 'move' : 'grab';
  }

  _onMouseUp(_e) {
    // Commit resize to backend if scale changed
    if (this._resizeHandle && this._selectedId) {
      const clip = this.project.clips.find(c => c.id === this._selectedId);
      if (clip) {
        this._el.dispatchEvent(new CustomEvent('canvas:clipresized', {
          bubbles: true, detail: { id: clip.id, scale: clip.scale }
        }));
      }
    }
    this._resizeHandle  = null;
    this._resizeOrigin  = null;
    this._dragClip      = null;
    this._snapTarget    = null;
    this._isPanning     = false;
    this._panDragOrigin = null;
    this._el.style.cursor = 'default';
    this.redraw();
  }

  _resizeCursor(handle) {
    return { tl: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', br: 'nwse-resize' }[handle] ?? 'default';
  }

  _loadMedia(url) {
    if (this._mediaCache.has(url)) return this._mediaCache.get(url);

    const ext     = url.split('.').pop().toLowerCase();
    const isVideo = ['mp4', 'webm', 'mov'].includes(ext);

    if (isVideo) {
      const vid   = document.createElement('video');
      vid.muted   = true;
      vid.preload = 'auto';
      const entry = { el: vid, loaded: false };
      this._mediaCache.set(url, entry);
      vid.addEventListener('loadeddata', () => { entry.loaded = true; this.redraw(); });
      vid.src = url;
      return entry;
    }

    const img   = new Image();
    const entry = { el: img, loaded: false };
    this._mediaCache.set(url, entry);
    img.onload = () => { entry.loaded = true; this.redraw(); };
    img.src = url;
    return entry;
  }
}