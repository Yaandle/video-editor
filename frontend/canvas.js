// canvas.js — HTML5 Canvas port of CanvasWidget
import { THEMES, TRACK_COLOURS } from './app.js';

const PY_KEYWORDS = new Set([
  'False','None','True','and','as','assert','async','await','break','class',
  'continue','def','del','elif','else','except','finally','for','from','global',
  'if','import','in','is','lambda','nonlocal','not','or','pass','raise','return',
  'try','while','with','yield'
]);

function tokenizeCode(code, theme) {
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

  const spans = [];
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
  spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const tokens = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start < cursor) continue;
    if (s.start > cursor) tokens.push({ text: code.slice(cursor, s.start), color: theme.text ?? '#1F2937', bold: false });
    tokens.push({ text: code.slice(s.start, s.end), color: s.color, bold: s.bold });
    cursor = s.end;
  }
  if (cursor < code.length) tokens.push({ text: code.slice(cursor), color: theme.text ?? '#1F2937', bold: false });
  return tokens;
}

function tokensToLines(tokens) {
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
    const c1 = overshoot, c3 = c1 + 1, x = t - 1;
    return 1 + c3 * x * x * x + c1 * x * x;
  }
};

// aspect derived from project at paint time — see _canvasRect()
const MIN_SCALE = 0.05;
const MAX_SCALE = 4.0;
const HANDLE_SIZE = 10;
const HANDLE_HIT_SIZE = 16; 
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4.0;

const SNAP_X = [0.25, 0.5, 0.75];  // left / centre / right
const SNAP_Y = [0.12, 0.5, 0.85];  // top / centre / bottom
const SNAP_THRESHOLD = 0.04;

export class CanvasWidget {
  
  constructor(canvasEl, project, selectedIds) {
    this._el = canvasEl;
    this._ctx = canvasEl.getContext('2d');
    this.project = project;
    this.playhead = 0.0;
    this._selectedIds = selectedIds || new Set();
    this._selectionPrimaryId = null;
    this._dragClip = null;
    this._dragOffsetX = 0;
    this._dragOffsetY = 0;
    this._snapTarget = null;
    this._mediaCache = new Map();
    this._groupDragOrigins = null;
    this._marqueeActive = false;
    this._marqueeStart = null;
    this._marqueeCurrent = null;
    this._marqueeShift = false;
    this._panY = 0;
    this._zoom = 1.0;
    this._panX = 0;

    this._isPanning = false;
    this._panDragOrigin = null; // { mouseX, mouseY, panX, panY }

    this._resizeHandle = null;   // 'tl'|'tr'|'bl'|'br' | null
    this._resizeOrigin = null;   // { mouseX, mouseY, scale, rectW, rectH, canvasRectH }
    this._drawnRects = new Map(); // clipId → {x,y,w,h}
    this._dragBeforeSnapshot = null;

    this._bindEvents();
    this.resize();
  }

  setProject(p) { this.project = p; this.redraw(); }
  setPlayhead(t) { this.playhead = t; this.redraw(); }
  setSelectedId(id) {
    this._selectedIds.clear();
    if (id) this._selectedIds.add(id);
    this.redraw();
  }
  setSelectedIds(selectedIds) { this._selectedIds = selectedIds; this.redraw(); }
  redraw() { this._paint(); }

  resize() {
    const frame = this._el.parentElement;
    this._el.width = frame.clientWidth;
    this._el.height = frame.clientHeight;
    this.redraw();
  }

  _canvasRect() {
    const w = this._el.width, h = this._el.height;
    const aspect = (this.project.canvas_w ?? 1080) / (this.project.canvas_h ?? 1920);
    const cw = Math.min(w, h * aspect) | 0;
    const ch = (cw / aspect) | 0;
    const x = ((w - cw) / 2) | 0;
    const y = ((h - ch) / 2) | 0;
    return { x, y, w: cw, h: ch };
  }

  _normToPx(nx, ny) {
    const r = this._canvasRect();
    return { x: r.x + nx * r.w | 0, y: r.y + ny * r.h | 0 };
  }

  _pxToNorm(px, py) {
    const r = this._canvasRect();
    const nx = (px - r.x) / r.w, ny = (py - r.y) / r.h;
    return { nx: Math.max(0, Math.min(1, nx)), ny: Math.max(0, Math.min(1, ny)) };
  }

  _toLogical(screenX, screenY) {
    return { x: (screenX - this._panX) / this._zoom, y: (screenY - this._panY) / this._zoom };
  }

  _activeClips() {
    return this.project.clips
      .filter(c => c.start <= this.playhead && this.playhead < c.end())
      .sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0));
  }

  _clipRect(clip, r) {
    const pt = this._normToPx(clip.x, clip.y);
    const maxW = (r.w * 0.88) | 0;
    return { x: pt.x - (maxW >> 1), y: pt.y - 14, w: maxW, h: 28 };
  }

  _handlePositions(rect) {
    return {
      tl: { x: rect.x, y: rect.y },
      tr: { x: rect.x + rect.w, y: rect.y },
      bl: { x: rect.x, y: rect.y + rect.h },
      br: { x: rect.x + rect.w, y: rect.y + rect.h },
    };
  }

  _hitHandle(px, py, rect) {
    const handles = this._handlePositions(rect);
    for (const [name, pt] of Object.entries(handles)) {
      if (Math.abs(px - pt.x) <= HANDLE_HIT_SIZE && Math.abs(py - pt.y) <= HANDLE_HIT_SIZE) {
        return name;
      }
    }
    return null;
  }

  _paint() {
    this._drawnRects.clear();
    const ctx = this._ctx, el = this._el, r = this._canvasRect(), theme = THEMES.dark;
    ctx.clearRect(0, 0, el.width, el.height);

    ctx.save();
    ctx.translate(this._panX, this._panY);
    ctx.scale(this._zoom, this._zoom);

    ctx.fillStyle = this.project.background_color ?? theme.bg;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#505050';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);

    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(59,130,246,0.24)';
    ctx.lineWidth = 1;
    const cx = r.x + (r.w >> 1);
    ctx.beginPath(); ctx.moveTo(cx, r.y); ctx.lineTo(cx, r.y + r.h); ctx.stroke();
    for (const frac of [1/3, 2/3]) {
      const gy = r.y + (r.h * frac) | 0;
      ctx.beginPath(); ctx.moveTo(r.x, gy); ctx.lineTo(r.x + r.w, gy); ctx.stroke();
    }
    ctx.setLineDash([]);

    if (this._snapTarget) {
      const { x: sx, y: sy } = this._snapTarget;
      if (sx != null) {
        const px = this._normToPx(sx, 0).x;
        ctx.strokeStyle = 'rgba(59,130,246,0.7)';
        ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke();
      }
      if (sy != null) {
        const py = this._normToPx(0, sy).y;
        ctx.beginPath(); ctx.moveTo(r.x, py); ctx.lineTo(r.x + r.w, py); ctx.stroke();
      }
    }

    for (const clip of this._activeClips()) this._drawClip(ctx, clip, r);

    if (this._selectedIds && this._selectedIds.size > 0) {
      if (this._selectedIds.size === 1) {
        const selId = this._selectedIds.values().next().value;
        const clip = this.project.clips.find(c => c.id === selId);
        if (clip) {
          if (['image','video','code','narration','shape'].includes(clip.clip_type)) {
            const drawn = this._drawnRects.get(clip.id);
            if (drawn) this._drawResizeOverlay(ctx, drawn);
          } else if (clip.track === 'text' || clip.track === 'visual') {
            const cr = this._clipRect(clip, r);
            ctx.strokeStyle = 'rgba(59,130,246,0.9)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(cr.x - 3, cr.y - 3, cr.w + 6, cr.h + 6);
            ctx.setLineDash([]);
          }
        }
      } else {
        let bx = Infinity, by = Infinity, bx2 = -Infinity, by2 = -Infinity;
        for (const id of this._selectedIds) {
          const d = this._drawnRects.get(id);
          if (!d) continue;
          bx = Math.min(bx, d.x); by = Math.min(by, d.y);
          bx2 = Math.max(bx2, d.x + d.w); by2 = Math.max(by2, d.y + d.h);
        }
        if (bx !== Infinity) {
          ctx.strokeStyle = 'rgba(59,130,246,0.9)';
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(bx - 6, by - 6, (bx2 - bx) + 12, (by2 - by) + 12);
          ctx.setLineDash([]);
        }
      }
    }

    ctx.restore();

    if (this._marqueeActive && this._marqueeStart && this._marqueeCurrent) {
      const mx = Math.min(this._marqueeStart.x, this._marqueeCurrent.x);
      const my = Math.min(this._marqueeStart.y, this._marqueeCurrent.y);
      const mw = Math.abs(this._marqueeStart.x - this._marqueeCurrent.x);
      const mh = Math.abs(this._marqueeStart.y - this._marqueeCurrent.y);
      ctx.save();
      ctx.fillStyle = 'rgba(59,130,246,0.12)';
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeStyle = 'rgba(59,130,246,0.9)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(mx + 0.5, my + 0.5, mw, mh);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  _drawResizeOverlay(ctx, rect) {
    ctx.strokeStyle = 'rgba(59,130,246,0.9)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4);
    ctx.setLineDash([]);

    const handles = this._handlePositions(rect);
    for (const pt of Object.values(handles)) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(59,130,246,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(pt.x - HANDLE_SIZE / 2, pt.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.fill(); ctx.stroke();
    }
  }

  _drawClip(ctx, clip, r) {
    const theme = THEMES[clip.theme] ?? THEMES.dark;
    if (clip.track === 'audio') return;

    const pt = this._normToPx(clip.x, clip.y);

    if (clip.clip_type === 'narration') {
      const sx = clip.scale_x ?? clip.scale ?? 1.0;

      const fontSize = clip.font_size ?? Math.max(7, (r.w / 18) | 0);
      const fontStyle = clip.font_italic ? 'italic ' : '';
      const fontWeight = clip.font_bold ? 'bold ' : '';
      ctx.font = `${fontStyle}${fontWeight}${fontSize}px Consolas, monospace`;
      const textColor = clip.font_color ?? theme.text;
      ctx.fillStyle = textColor;
      ctx.textBaseline = 'top';

      const lineHeight = fontSize * 1.4;
      const baseMaxW = (r.w * 0.88) | 0;
      const maxW = (baseMaxW * sx) | 0;

      const layout = this._layoutNarrationText(ctx, clip.content, maxW, lineHeight);
      const elapsedMs = Math.max(0, this.playhead - clip.start) * 1000;

      if (clip.text_anim_style && clip.text_anim_style !== 'static') {
        this._renderNarrationAnimated(ctx, layout, pt.x, pt.y, elapsedMs, clip, textColor);
      } else {
        ctx.textAlign = 'center';
        this._renderNarrationStatic(ctx, layout, pt.x, pt.y, textColor);
      }

      const bx = pt.x - (maxW >> 1), by = pt.y;
      const height = layout.lines.length * lineHeight;
      this._drawnRects.set(clip.id, { x: bx, y: by, w: maxW, h: height });
    }
    else if (clip.clip_type === 'code') {
      this._drawCodeTerminal(ctx, clip, r, pt, theme);
    }
    else if (clip.clip_type === 'graph') {
      const blockH = (r.h * 0.35) | 0;
      const blockW = (r.w * 0.88) | 0;
      const bx = r.x + ((r.w - blockW) >> 1);
      const by = pt.y - (blockH >> 1);
      ctx.fillStyle = theme.bg;
      ctx.fillRect(bx, by, blockW, blockH);
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, blockW, blockH);
      this._drawGraphPreview(ctx, clip, bx, by, blockW, blockH, theme, r);
    }
    else if (clip.clip_type === 'image' || clip.clip_type === 'video') {
      this._drawMedia(ctx, clip, r, pt);
    }
    else if (clip.clip_type === 'shape') {
      this._drawShape(ctx, clip, r, pt, theme);
    }
  }

  _drawCodeTerminal(ctx, clip, r, pt, theme) {
    const blockW = Math.floor(r.w * 0.92);
    const maxBlockH = Math.min(Math.floor(r.h * 0.60), 360);
    const titleH = 30;
    const promptH = clip.terminal_prompt ? 26 : 0;
    const padX = 14, padY = 12;
    const bx = r.x + ((r.w - blockW) >> 1);
    const fontSize = Math.max(10, Math.floor(r.w / 46));
    const lineH = Math.round(fontSize * 1.55);
    const gutterW = Math.max(34, fontSize * 2.5);

    const lines = tokensToLines(tokenizeCode(clip.content ?? "", theme));
    const contentHeight = lines.length * lineH + padY * 2;
    const blockH = Math.min(maxBlockH, titleH + promptH + contentHeight);
    const by = pt.y - (blockH >> 1);

    this._drawnRects.set(clip.id, { x: bx, y: by, w: blockW, h: blockH });

    // Window
    ctx.fillStyle = theme.bg || "#1e1e1e";
    ctx.fillRect(bx, by, blockW, blockH);
    ctx.strokeStyle = theme.border || "#3c3c3c";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + .5, by + .5, blockW, blockH);

    // Titlebar
    ctx.fillStyle = theme.titlebar || this._shade(theme.bg, 1.12);
    ctx.fillRect(bx, by, blockW, titleH);

    const iconColor = theme.comment ?? "#9ca3af";
    const iconSize = 9, iconGap = 18, rightPad = 16;
    const iconCY = by + titleH / 2;
    const closeCX = bx + blockW - rightPad - iconSize / 2;
    const maxCX = closeCX - iconGap;
    const minCX = maxCX - iconGap;

    ctx.strokeStyle = iconColor;
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";

    ctx.beginPath(); ctx.moveTo(minCX - iconSize / 2, iconCY); ctx.lineTo(minCX + iconSize / 2, iconCY); ctx.stroke();
    ctx.strokeRect(maxCX - iconSize / 2, iconCY - iconSize / 2, iconSize, iconSize);
    ctx.beginPath();
    ctx.moveTo(closeCX - iconSize / 2, iconCY - iconSize / 2);
    ctx.lineTo(closeCX + iconSize / 2, iconCY + iconSize / 2);
    ctx.moveTo(closeCX + iconSize / 2, iconCY - iconSize / 2);
    ctx.lineTo(closeCX - iconSize / 2, iconCY + iconSize / 2);
    ctx.stroke();

    if (clip.terminal_title) {
      ctx.fillStyle = theme.comment || "#9ca3af";
      ctx.font = `600 ${fontSize}px Consolas`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(clip.terminal_title, bx + blockW / 2, iconCY);
    }

    // Prompt
    let contentTop = by + titleH;
    if (clip.terminal_prompt) {
      ctx.fillStyle = theme.bg;
      ctx.fillRect(bx, contentTop, blockW, promptH);
      ctx.font = `${fontSize}px Consolas`;
      ctx.fillStyle = theme.function || "#4ec9b0";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(clip.terminal_prompt, bx + padX, contentTop + promptH / 2);
      contentTop += promptH;
    }

    // Gutter + divider
    ctx.fillStyle = this._withAlpha(theme.titlebar ?? "#252526", 0.65);
    ctx.fillRect(bx, contentTop, gutterW + 4, blockH - titleH - promptH);
    ctx.strokeStyle = theme.gutterBorder ?? this._withAlpha(theme.text ?? "#e6edf3", 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + gutterW + 4.5, contentTop);
    ctx.lineTo(bx + gutterW + 4.5, by + blockH);
    ctx.stroke();

    // Code (clipped, with typewriter)
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, contentTop, blockW, blockH - titleH - promptH);
    ctx.clip();
    ctx.font = `${fontSize}px Consolas`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const codeY = contentTop + padY;
    const anim = clip.anim_mode ?? clip.animation;
    let typedChars = Infinity;
    if (anim === "typewriter") {
      const elapsed = Math.max(0, this.playhead - clip.start);
      typedChars = elapsed * (clip.type_speed ?? 40);
    }

    let charsUsed = 0;
    let cursorX = bx + gutterW + padX, cursorY = codeY;

    for (let i = 0; i < lines.length; i++) {
      const y = codeY + i * lineH;
      ctx.fillStyle = theme.comment || "#6b7280";
      ctx.textAlign = "right";
      ctx.fillText(i + 1, bx + gutterW - 10, y);
      ctx.textAlign = "left";

      let x = bx + gutterW + padX;
      for (const tok of lines[i]) {
        let text = tok.text;
        if (charsUsed >= typedChars) break;
        const remain = typedChars - charsUsed;
        if (text.length > remain) text = text.slice(0, remain);

        ctx.font = `${tok.bold ? "bold " : ""}${fontSize}px Consolas`;
        ctx.fillStyle = tok.color;
        ctx.fillText(text, x, y);

        const textWidth = ctx.measureText(text).width;
        x += textWidth;
        charsUsed += text.length;
        cursorX = x; cursorY = y;
        if (text.length < tok.text.length) break;
      }
      if (charsUsed >= typedChars) break;
    }

    if (clip.show_cursor !== false) {
      const blink = Math.floor(this.playhead * 2) % 2 === 0;
      if (blink) {
        ctx.fillStyle = theme.cursor ?? "#ffffff";
        ctx.fillRect(cursorX, cursorY + 1, Math.max(2, fontSize * 0.15), lineH - 2);
      }
    }
    ctx.restore();
  }

  _withAlpha(hex, alpha) {
    if (!hex || hex[0] !== '#') return hex;
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  _layoutNarrationText(ctx, text, maxWidth, lineHeight) {
    const paragraphs = text.split('\n');
    const spaceWidth = ctx.measureText(' ').width;
    const lines = [];
    let gWord = 0, gChar = 0;

    for (const para of paragraphs) {
      const rawWords = para.split(' ');
      let currentLine = [], currentWidth = 0;

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
    }

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

  _renderNarrationStatic(ctx, layout, ox, oy, color) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    for (const line of layout.lines) {
      const lineOx = ox - line.lineWidth / 2;
      for (const word of line.words) ctx.fillText(word.text, lineOx + word.x, oy + line.y);
    }
    ctx.restore();
  }

  _renderNarrationAnimated(ctx, layout, ox, oy, elapsedMs, clip, color) {
    if (clip.text_anim_style === 'typewriter') {
      this._renderNarrationTypewriter(ctx, layout, ox, oy, elapsedMs, clip, color);
    } else if (clip.text_anim_style === 'wordblurin') {
      this._renderNarrationWordBlurIn(ctx, layout, ox, oy, elapsedMs, clip, color);
    } else if (clip.text_anim_style === 'linescan') {
      this._renderNarrationLineScan(ctx, layout, ox, oy, elapsedMs, clip, color);
    } else {
      this._renderNarrationStatic(ctx, layout, ox, oy, color);
    }
  }

  _renderNarrationTypewriter(ctx, layout, ox, oy, elapsedMs, clip, color) {
    const msPerChar = 1000 / (clip.text_chars_per_second ?? 26);
    const popMs = clip.text_pop_duration_ms ?? 90;
    let lastX = ox, lastY = oy;
    const lastH = layout.lineHeight * 0.78;
    let allDone = true;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;

    for (const line of layout.lines) {
      const lineOx = ox - line.lineWidth / 2;
      for (const word of line.words) {
        for (const ch of word.chars) {
          const revealAt = ch.globalIndex * msPerChar;
          const localT = elapsedMs - revealAt;
          if (localT < 0) { allDone = false; continue; }
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
        ctx.fillStyle = color;
        ctx.fillRect(lastX + 2, lastY, 3, lastH);
      }
    }
    ctx.restore();
  }

  _renderNarrationWordBlurIn(ctx, layout, ox, oy, elapsedMs, clip, color) {
    const stagger = clip.text_stagger_ms ?? 60;
    const dur = clip.text_duration_ms ?? 550;
    const maxBlur = clip.text_max_blur ?? 14;
    const rise = clip.text_rise_distance ?? 22;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;

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
    const url = clip.code_file;

    if (!url) {
      this._drawPlaceholder(ctx, '[no media]', pt, r, theme);
      return;
    }

    const entry = this._loadMedia(url);
    if (!entry.loaded) {
      this._drawPlaceholder(ctx, '[loading…]', pt, r, theme);
      const maxW = (r.w * 0.88) | 0, maxH = (r.h * 0.50) | 0;
      this._drawnRects.set(clip.id, { x: pt.x - (maxW >> 1), y: pt.y - (maxH >> 1), w: maxW, h: maxH });
      return;
    }

    const el = entry.el;
    const natW = el.naturalWidth || el.videoWidth || 1;
    const natH = el.naturalHeight || el.videoHeight || 1;

    if (clip.clip_type === 'video') {
      const target = Math.max(0, this.playhead - clip.start);
      if (Math.abs(el.currentTime - target) > 0.15) el.currentTime = target;
    }

    const scale = clip.scale ?? 1.0;
    const maxW = (r.w * 0.88) | 0, maxH = (r.h * 0.80) | 0;
    const fitScale = Math.min(maxW / natW, maxH / natH, 1);
    const dw = (natW * fitScale * scale) | 0, dh = (natH * fitScale * scale) | 0;
    const dx = pt.x - (dw >> 1), dy = pt.y - (dh >> 1);

    ctx.drawImage(el, dx, dy, dw, dh);
    this._drawnRects.set(clip.id, { x: dx, y: dy, w: dw, h: dh });
  }

  _drawShape(ctx, clip, r, pt, theme) {
    const BASE_W = 200, BASE_H = 200;
    const maxW = (r.w * 0.88) | 0;
    const maxH = (r.h * 0.80) | 0;
    const fitScale = Math.min(maxW / BASE_W, maxH / BASE_H, 1);

    const sx = clip.scale_x ?? clip.scale ?? 1.0;
    const sy = clip.scale_y ?? clip.scale ?? 1.0;
    const dw = BASE_W * fitScale * sx;
    const dh = BASE_H * fitScale * sy;

    const dx = pt.x - dw / 2;
    const dy = pt.y - dh / 2;
    const cx = pt.x, cy = pt.y;

    ctx.save();
    ctx.globalAlpha = clip.opacity ?? 1.0;
    ctx.translate(cx, cy);
    ctx.rotate((clip.rotation ?? 0) * Math.PI / 180);
    ctx.translate(-cx, -cy);

    ctx.fillStyle = clip.fill;
    ctx.strokeStyle = clip.stroke_color;
    ctx.lineWidth = clip.stroke_width ?? 0;

    const x0 = dx, y0 = dy, x1 = dx + dw, y1 = dy + dh;
    const strokeIfNeeded = () => { if ((clip.stroke_width ?? 0) > 0) ctx.stroke(); };

    switch (clip.shape_kind) {
      case 'rectangle': {
        ctx.beginPath();
        const rr = Math.min(clip.corner_radius ?? 0, dw / 2, dh / 2);
        if (rr > 0 && typeof ctx.roundRect === 'function') {
          ctx.roundRect(x0, y0, dw, dh, rr);
        } else if (rr > 0) {
          ctx.moveTo(x0 + rr, y0);
          ctx.lineTo(x1 - rr, y0);
          ctx.arcTo(x1, y0, x1, y0 + rr, rr);
          ctx.lineTo(x1, y1 - rr);
          ctx.arcTo(x1, y1, x1 - rr, y1, rr);
          ctx.lineTo(x0 + rr, y1);
          ctx.arcTo(x0, y1, x0, y1 - rr, rr);
          ctx.lineTo(x0, y0 + rr);
          ctx.arcTo(x0, y0, x0 + rr, y0, rr);
          ctx.closePath();
        } else {
          ctx.rect(x0, y0, dw, dh);
        }
        ctx.fill(); strokeIfNeeded();
        break;
      }
      case 'circle': {
        ctx.beginPath();
        ctx.ellipse(cx, cy, dw / 2, dh / 2, 0, 0, Math.PI * 2);
        ctx.fill(); strokeIfNeeded();
        break;
      }
      case 'triangle': {
        ctx.beginPath();
        ctx.moveTo(cx, y0); ctx.lineTo(x1, y1); ctx.lineTo(x0, y1);
        ctx.closePath();
        ctx.fill(); strokeIfNeeded();
        break;
      }
      case 'polygon': {
        const sides = Math.max(3, clip.sides ?? 5);
        const rad = Math.min(dw, dh) / 2;
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
          const ang = -Math.PI / 2 + i * (2 * Math.PI / sides);
          const px = cx + rad * Math.cos(ang), py = cy + rad * Math.sin(ang);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill(); strokeIfNeeded();
        break;
      }
      case 'star': {
        const points = Math.max(2, clip.points ?? 5);
        const outerR = Math.min(dw, dh) / 2;
        const innerR = outerR * (clip.inner_radius_ratio ?? 0.5);
        ctx.beginPath();
        const total = points * 2;
        for (let i = 0; i < total; i++) {
          const rad = i % 2 === 0 ? outerR : innerR;
          const ang = -Math.PI / 2 + i * (Math.PI / points);
          const px = cx + rad * Math.cos(ang), py = cy + rad * Math.sin(ang);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill(); strokeIfNeeded();
        break;
      }
      case 'line': {
        ctx.beginPath();
        ctx.moveTo(x0, cy); ctx.lineTo(x1, cy);
        ctx.lineWidth = Math.max(clip.stroke_width ?? 0, 2);
        ctx.strokeStyle = clip.stroke_color || clip.fill;
        ctx.stroke();
        break;
      }
      case 'arrow': {
        const shaftW = dh * 0.25, headW = dh * 0.6, headLen = dw * 0.35;
        ctx.beginPath();
        ctx.moveTo(x0, cy - shaftW / 2);
        ctx.lineTo(x1 - headLen, cy - shaftW / 2);
        ctx.lineTo(x1 - headLen, cy - headW / 2);
        ctx.lineTo(x1, cy);
        ctx.lineTo(x1 - headLen, cy + headW / 2);
        ctx.lineTo(x1 - headLen, cy + shaftW / 2);
        ctx.lineTo(x0, cy + shaftW / 2);
        ctx.closePath();
        ctx.fill(); strokeIfNeeded();
        break;
      }
      default: {
        ctx.beginPath();
        ctx.rect(x0, y0, dw, dh);
        ctx.fill(); strokeIfNeeded();
      }
    }

    ctx.restore();
    this._drawnRects.set(clip.id, { x: dx, y: dy, w: dw, h: dh });
  }

  _drawPlaceholder(ctx, text, pt, r, theme) {
    ctx.fillStyle = theme.comment ?? '#888';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.max(6, r.w / 28 | 0)}px Consolas, monospace`;
    ctx.fillText(text, pt.x, pt.y);
  }

  _drawWrappedText(ctx, text, cx, y, maxW, lineH) {
    const words = text.split(' ');
    let line = '', curY = y;
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
    const endY = curY + lineH;
    return { startY, endY, height: endY - startY };
  }

  _drawGraphPreview(ctx, clip, bx, by, bw, bh, theme, r) {
    const pairs = [];
    for (const token of clip.graph_data.split(',')) {
      const t = token.trim();
      const colon = t.indexOf(':');
      if (colon >= 0) {
        const label = t.slice(0, colon).trim();
        const val = parseFloat(t.slice(colon + 1).trim());
        if (!isNaN(val)) pairs.push([label, val]);
      }
    }
    if (!pairs.length) return;

    const maxVal = Math.max(...pairs.map(p => p[1])) || 1;
    const n = pairs.length, pad = 12;
    const barAreaW = bw - pad * 2;
    const barW = Math.max(4, (barAreaW / n) - 4 | 0);
    const barAreaH = bh - pad * 3;
    const barColor = theme.function ?? '#2563EB';
    const labelColor = theme.comment ?? '#6B7280';
    const fontSize = Math.max(5, (bw / 28) | 0);
    ctx.font = `${fontSize}px Consolas, monospace`;

    for (let i = 0; i < pairs.length; i++) {
      const [label, val] = pairs[i];
      const barH = ((val / maxVal) * barAreaH) | 0;
      const bxi = bx + pad + i * (barW + 4);
      const byi = by + bh - pad - barH;
      ctx.fillStyle = barColor;
      ctx.fillRect(bxi, byi, barW, barH);
      ctx.fillStyle = labelColor;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label.slice(0, 4), bxi, by + bh - 2);
    }
  }

  _bindEvents() {
    const el = this._el;
    el.addEventListener('mousedown', e => this._onMouseDown(e));
    el.addEventListener('mousemove', e => this._onMouseMove(e));
    el.addEventListener('mouseup', e => this._onMouseUp(e));
    el.addEventListener('mouseleave', e => this._onMouseUp(e));
    el.addEventListener('wheel', e => this._onWheel(e), { passive: false });
  }

  _getPos(e) {
    const rect = this._el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _clipAt(px, py) {
    const r = this._canvasRect();
    const clips = this._activeClips();

    for (let i = clips.length - 1; i >= 0; i--) {
      const clip = clips[i];
      if (clip.track === 'audio') continue;

      if (['image','video','shape','code','narration'].includes(clip.clip_type)) {
        const drawn = this._drawnRects.get(clip.id);
        if (drawn) {
          if (px >= drawn.x && px <= drawn.x + drawn.w && py >= drawn.y && py <= drawn.y + drawn.h) return clip;
          continue;
        }
        const pt = this._normToPx(clip.x, clip.y);
        const fallbackR = 60;
        if (Math.abs(px - pt.x) < fallbackR && Math.abs(py - pt.y) < fallbackR) return clip;
        continue;
      }

      const cr = this._clipRect(clip, r);
      if (px >= cr.x - 6 && px <= cr.x + cr.w + 6 && py >= cr.y - 6 && py <= cr.y + cr.h + 6) return clip;
    }
    return null;
  }

  _onWheel(e) {
    e.preventDefault();
    const raw = this._getPos(e);
    const oldZoom = this._zoom;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor));
    if (newZoom === oldZoom) return;

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

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this._isPanning = true;
      this._panDragOrigin = { mouseX: raw.x, mouseY: raw.y, panX: this._panX, panY: this._panY };
      this._el.style.cursor = 'grabbing';
      return;
    }

    for (const selectedId of this._selectedIds) {
      const clip = this.project.clips.find(c => c.id === selectedId);
      if (!clip) continue;
      if (!['image', 'video', 'code', 'narration', 'shape'].includes(clip.clip_type)) continue;
      const drawn = this._drawnRects.get(clip.id);
      if (!drawn) continue;
      const handle = this._hitHandle(pos.x, pos.y, drawn);
      if (!handle) continue;

      const handles  = this._handlePositions(drawn);
      const opposite = { tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' }[handle];
      const anchor   = handles[opposite];
      const grabbed  = handles[handle];          // the actual corner you clicked near
      const scaleX0 = clip.scale_x ?? 1.0;
      const scaleY0 = clip.scale_y ?? 1.0;

      this._resizeHandle = handle;
      this._dragClip = clip;
      this._resizeOrigin = {
        anchorX: anchor.x,
        anchorY: anchor.y,
        grabOffsetX: pos.x - grabbed.x,
        grabOffsetY: pos.y - grabbed.y,
        baseW:   drawn.w / scaleX0,
        baseH:   drawn.h / scaleY0,
      };
      this._dragBeforeSnapshot = JSON.stringify(this.project.toDict());
      this._el.style.cursor = this._resizeCursor(handle);
      return;
    }

    const clip = this._clipAt(pos.x, pos.y);
    if (clip) {
      const isSelected = this._selectedIds.has(clip.id);
      if (e.shiftKey) {
        isSelected ? this._selectedIds.delete(clip.id) : this._selectedIds.add(clip.id);
      } else if (!isSelected) {
        this._selectedIds.clear();
        this._selectedIds.add(clip.id);
      }
      this._selectionPrimaryId = clip.id;
      this._el.dispatchEvent(new CustomEvent('canvas:selectionchanged', {
        bubbles: true, detail: { selectedIds: [...this._selectedIds], primaryId: clip.id }
      }));
      this._dragClip = clip;
      this._groupDragOrigins = new Map(
        [...this._selectedIds].map(id => {
          const c = this.project.clips.find(c => c.id === id);
          return [id, c ? { x: c.x, y: c.y } : { x: 0, y: 0 }];
        })
      );
      const pt = this._normToPx(clip.x, clip.y);
      this._dragOffsetX = pos.x - pt.x;
      this._dragOffsetY = pos.y - pt.y;
      this._dragBeforeSnapshot = JSON.stringify(this.project.toDict());
      this._el.style.cursor = 'move';
    } else {
      this._dragClip = null;

      if (!e.shiftKey) {
        this._selectedIds.clear();
        this._selectionPrimaryId = null;
        this._el.dispatchEvent(new CustomEvent('canvas:selectionchanged', {
          bubbles: true, detail: { selectedIds: [], primaryId: null }
        }));
      }

      this._marqueeActive = true;
      this._marqueeStart = { x: raw.x, y: raw.y };
      this._marqueeCurrent = { x: raw.x, y: raw.y };
      this._marqueeShift = e.shiftKey;
      this._el.style.cursor = 'crosshair';
    }
  }

  _onMouseMove(e) {
    const raw = this._getPos(e);
    const pos = this._toLogical(raw.x, raw.y);

    if (this._marqueeActive && (e.buttons & 1)) {
      this._marqueeCurrent = { x: raw.x, y: raw.y };
      this.redraw();
      return;
    }

    if (this._resizeHandle && (e.buttons & 1)) {
      const clip = this._dragClip;
      if (clip) {
        const o = this._resizeOrigin;
        const cornerX = pos.x - o.grabOffsetX;   
        const cornerY = pos.y - o.grabOffsetY;

        let newW = Math.abs(cornerX - o.anchorX);
        let newH = Math.abs(cornerY - o.anchorY);

        if (e.shiftKey) {
          const aspect = o.baseW / o.baseH;
          if (newW / newH > aspect) newW = newH * aspect;
          else newH = newW / aspect;
        }

        const scaleX = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newW / o.baseW));
        const scaleY = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newH / o.baseH));

        const dw = o.baseW * scaleX;
        const dh = o.baseH * scaleY;
        const signX = (this._resizeHandle === 'br' || this._resizeHandle === 'tr') ? 1 : -1;
        const signY = (this._resizeHandle === 'br' || this._resizeHandle === 'bl') ? 1 : -1;
        const newCx = o.anchorX + signX * dw / 2;
        const newCy = o.anchorY + signY * dh / 2;

        const { nx, ny } = this._pxToNorm(newCx, newCy);
        clip.scale_x = parseFloat(scaleX.toFixed(3));
        clip.scale_y = parseFloat(scaleY.toFixed(3));
        clip.x = nx;
        clip.y = ny;

        this._el.dispatchEvent(new CustomEvent('canvas:clipresized', {
          bubbles: true, detail: { id: clip.id, scale_x: clip.scale_x, scale_y: clip.scale_y, x: clip.x, y: clip.y }
        }));
        this.redraw();
      }
      return;
    }

    if (this._isPanning && (e.buttons & 1)) {
      const rawPos = this._getPos(e);
      const o = this._panDragOrigin;
      this._panX = o.panX + (rawPos.x - o.mouseX);
      this._panY = o.panY + (rawPos.y - o.mouseY);
      this.redraw();
      return;
    }

    if (this._dragClip && (e.buttons & 1)) {
      const rawX = pos.x - this._dragOffsetX, rawY = pos.y - this._dragOffsetY;
      let { nx, ny } = this._pxToNorm(rawX, rawY);

      this._snapTarget = null;
      let snappedX = false, snappedY = false;
      for (const sx of SNAP_X) { if (Math.abs(nx - sx) < SNAP_THRESHOLD) { nx = sx; snappedX = true; break; } }
      for (const sy of SNAP_Y) { if (Math.abs(ny - sy) < SNAP_THRESHOLD) { ny = sy; snappedY = true; break; } }
      if (snappedX || snappedY) this._snapTarget = { x: snappedX ? nx : null, y: snappedY ? ny : null };

      if (this._groupDragOrigins && this._selectedIds.has(this._dragClip.id)) {
        const origin = this._groupDragOrigins.get(this._dragClip.id);
        const deltaX = nx - origin.x, deltaY = ny - origin.y;
        for (const [id, clipOrigin] of this._groupDragOrigins.entries()) {
          const clip = this.project.clips.find(c => c.id === id);
          if (!clip) continue;
          clip.x = Math.max(0, Math.min(1, clipOrigin.x + deltaX));
          clip.y = Math.max(0, Math.min(1, clipOrigin.y + deltaY));
        }
      } else {
        this._dragClip.x = nx;
        this._dragClip.y = ny;
      }

      this._el.dispatchEvent(new CustomEvent('canvas:clipmoved', {
        bubbles: true, detail: { id: this._dragClip.id, nx, ny, selected: Array.from(this._selectedIds) }
      }));
      this.redraw();
      return;
    }

    const selectedId = this._selectedIds.values().next().value;
    if (selectedId) {
      const clip = this.project.clips.find(c => c.id === selectedId);
      if (clip && (clip.clip_type === 'image' || clip.clip_type === 'video')) {
        const drawn = this._drawnRects.get(clip.id);
        if (drawn) {
          const handle = this._hitHandle(pos.x, pos.y, drawn);
          if (handle) { this._el.style.cursor = this._resizeCursor(handle); return; }
        }
      }
    }
    const clip = this._clipAt(pos.x, pos.y);
    this._el.style.cursor = clip ? 'move' : 'grab';
  }

  _onMouseUp(_e) {
    if (this._resizeHandle) {
      const clip = this._dragClip;
      if (clip) {
        this._el.dispatchEvent(new CustomEvent('canvas:clipresized', {
          bubbles: true, detail: { id: clip.id, scale_x: clip.scale_x, scale_y: clip.scale_y }
        }));
      }
    }

    if (this._marqueeActive) {
      this._marqueeActive = false;
      const start = this._marqueeStart, end = this._marqueeCurrent;
      if (start && end) {
        const rect = {
          x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
          w: Math.abs(start.x - end.x), h: Math.abs(start.y - end.y)
        };
        const selected = new Set(this._selectedIds);
        for (const clip of this.project.clips) {
          const pt = this._normToPx(clip.x, clip.y);
          const isInside = pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h;
          if (!isInside) continue;
          if (this._marqueeShift) {
            selected.has(clip.id) ? selected.delete(clip.id) : selected.add(clip.id);
          } else {
            selected.add(clip.id);
          }
        }
        if (!this._marqueeShift) {
          for (const id of Array.from(selected)) {
            if (!this.project.clips.some(c => c.id === id)) selected.delete(id);
          }
        }
        this._selectedIds = selected;
        this._el.dispatchEvent(new CustomEvent('canvas:selectionchanged', {
          bubbles: true,
          detail: { selectedIds: Array.from(this._selectedIds), primaryId: this._selectedIds.values().next().value }
        }));
      }
      this._marqueeStart = null;
      this._marqueeCurrent = null;
      this._marqueeShift = false;
    }

    if (this._dragBeforeSnapshot) {
      this._el.dispatchEvent(new CustomEvent('canvas:committed', {
        bubbles: true, detail: { before: this._dragBeforeSnapshot }
      }));
    }
    this._dragBeforeSnapshot = null;
    this._resizeHandle = null;
    this._resizeOrigin = null;
    this._dragClip = null;
    this._groupDragOrigins = null;
    this._snapTarget = null;
    this._isPanning = false;
    this._panDragOrigin = null;
    this._el.style.cursor = 'default';
    this.redraw();
  }

  _resizeCursor(handle) {
    return { tl: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', br: 'nwse-resize' }[handle] ?? 'default';
  }

  _loadMedia(url) {
    if (this._mediaCache.has(url)) return this._mediaCache.get(url);

    const ext = url.split('.').pop().toLowerCase();
    const isVideo = ['mp4', 'webm', 'mov'].includes(ext);

    if (isVideo) {
      const vid = document.createElement('video');
      vid.muted = true;
      vid.preload = 'auto';
      const entry = { el: vid, loaded: false };
      this._mediaCache.set(url, entry);
      vid.addEventListener('loadeddata', () => { entry.loaded = true; this.redraw(); });
      vid.src = url;
      return entry;
    }

    const img = new Image();
    const entry = { el: img, loaded: false };
    this._mediaCache.set(url, entry);
    img.onload = () => { entry.loaded = true; this.redraw(); };
    img.src = url;
    return entry;
  }
}