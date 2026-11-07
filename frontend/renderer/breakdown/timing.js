// timing.js — the footy-breakdown timeline, in whole frames. Pure (no DOM).
//
// A moment plays its clip from in_f up to freeze_f, holds freeze_f while the
// coach explains, resumes to out_f (optionally slow for part of it), then holds
// out_f for the closing line. Several moments play one after another.
//
// Units: source frames are integers of the clip's constant-frame-rate proxy
// (src_fps); output frames are integers at the project fps. Every segment
// boundary is a whole output frame, and each segment re-anchors its source
// position, so error never accumulates from one segment to the next. The
// freeze always shows exactly freeze_f, starting on the first output frame at
// which the playhead reaches it.

export const EPS = 1e-7;

export const DEFAULTS = Object.freeze({
  lead_in_rate: 1,          // playback rate into the freeze
  resume_rate: 0.5,         // playback rate out of the freeze (until slow_until_f)
  settle_s: 0.5,            // freeze lands → dim is in and annotations start
  per_annotation_s: 0.3,    // stagger between annotation draw-ons
  read_base_s: 1.0,         // reading time: base …
  read_per_word_s: 0.26,    // … plus this per word
  hold_min_s: 3,
  hold_max_s: 8,
  end_min_s: 1.2,           // shortest hold on the last frame
  outcome_lead_s: 1,        // the outcome line appears this long before the play-out ends
  voice_pad_s: 0.5,         // silence either side of a voice line in the hold
  gap_s: 0,                 // output pause between moments (holds the previous end frame)
});

/** Words in a caption (markup brackets ignored). */
export function wordCount(text) {
  return String(text ?? '').replace(/\[\[|\]\]|\{\{|\}\}/g, ' ').split(/\s+/).filter(Boolean).length;
}

/** Seconds a viewer needs to read `texts` (one or many lines), clamped. */
export function readingSeconds(texts, o = DEFAULTS) {
  const list = Array.isArray(texts) ? texts : [texts];
  const words = list.reduce((n, s) => n + wordCount(s), 0);
  if (!words) return 0;
  return o.read_base_s + words * o.read_per_word_s;
}

/** Source frames advanced per output frame at `rate`. */
export function step(rate, srcFps, outFps) {
  return (rate * srcFps) / outFps;
}

/**
 * Output frames a play segment needs so the playhead, starting at srcFrom and
 * advancing step(rate) source frames per output frame, first reaches srcTo on
 * the frame *after* the segment (the freeze or the next segment owns srcTo).
 */
export function playFrames(srcFrom, srcTo, rate, srcFps, outFps) {
  if (srcTo <= srcFrom) return 0;
  return Math.max(1, Math.ceil((srcTo - srcFrom) / step(rate, srcFps, outFps) - EPS));
}

const secToFrames = (s, fps) => Math.max(0, Math.round(s * fps));

function captionTexts(list) {
  return (list ?? []).map((c) => (typeof c === 'string' ? c : c?.text ?? '')).filter(Boolean);
}

/**
 * Build the plan for a breakdown scene.
 *   clip:    { fps (source, CFR), frames }
 *   moments: [{ id, in_f, freeze_f, out_f, slow_until_f?, playback?: {...}, captions: { freeze: [], outcome },
 *              annotations: [], voice_s? }]
 *   fps:     output frame rate
 * Returns { fps, srcFps, frames, segments: [...], moments: [...] }.
 *   segment: { kind: 'play'|'freeze'|'resume'|'end'|'gap', moment, out0, out1 (exclusive), src0, src1, rate }
 *   moment:  { id, index, out0, freeze0, settle, annotate0, caption0, hold1 (= resume0), resume1, outcome0, end1, … }
 */
export function plan({ clip, moments, fps, options = {} }) {
  const o = { ...DEFAULTS, ...options };
  const srcFps = Number(clip?.fps);
  if (!(srcFps > 0)) throw new Error('breakdown: clip.fps must be a positive number');
  if (!(fps > 0)) throw new Error('breakdown: output fps must be positive');
  const lastFrame = Number.isFinite(clip?.frames) ? clip.frames - 1 : Infinity;
  const segments = [];
  const out = [];
  let n = 0;
  (moments ?? []).forEach((m, index) => {
    const pb = { ...o, ...(m.playback ?? {}) };
    const inF = int(m.in_f, 'in_f', m), fz = int(m.freeze_f, 'freeze_f', m), outF = int(m.out_f, 'out_f', m);
    if (!(inF <= fz && fz <= outF)) throw new Error(`breakdown: moment ${m.id}: need in_f <= freeze_f <= out_f (${inF}, ${fz}, ${outF})`);
    if (inF < 0 || outF > lastFrame) throw new Error(`breakdown: moment ${m.id}: frames ${inF}-${outF} outside the clip (0-${lastFrame})`);
    const slowTo = Math.min(outF, Math.max(fz, m.slow_until_f ?? outF));
    if (index > 0 && pb.gap_s > 0) {
      const g = secToFrames(pb.gap_s, fps);
      const prev = segments[segments.length - 1];
      segments.push({ kind: 'gap', moment: index - 1, out0: n, out1: n + g, src0: prev.src1, src1: prev.src1, rate: 0 });
      n += g;
    }
    const rec = { id: m.id, index, out0: n };
    // 1 — lead-in
    const kIn = playFrames(inF, fz, pb.lead_in_rate, srcFps, fps);
    if (kIn) segments.push({ kind: 'play', moment: index, out0: n, out1: n + kIn, src0: inF, src1: fz, rate: pb.lead_in_rate });
    n += kIn;
    // 2 — freeze: settle, annotations draw on, caption, hold
    const nAnn = (m.annotations ?? []).length;
    const settle = secToFrames(pb.settle_s, fps);
    const annotate = secToFrames(nAnn * pb.per_annotation_s, fps);
    const read = readingSeconds(captionTexts(m.captions?.freeze), pb);
    const voice = Number(m.voice_s) > 0 ? Number(m.voice_s) + 2 * pb.voice_pad_s : 0;
    const auto = Math.min(pb.hold_max_s, Math.max(pb.hold_min_s, read + nAnn * pb.per_annotation_s));
    const holdS = Math.max(Number(pb.hold_s) > 0 ? Number(pb.hold_s) : auto, voice);
    const hold = Math.max(settle + annotate + 1, secToFrames(pb.settle_s + holdS, fps));
    rec.freeze0 = n;
    rec.annotate0 = n + settle;
    rec.caption0 = n + settle + Math.min(annotate, secToFrames(0.6, fps));
    rec.voice0 = voice ? n + settle + secToFrames(pb.voice_pad_s, fps) : null;
    segments.push({ kind: 'freeze', moment: index, out0: n, out1: n + hold, src0: fz, src1: fz, rate: 0 });
    n += hold;
    rec.hold1 = rec.resume0 = n;
    // 3 — resume (slow part, then normal speed)
    const kSlow = playFrames(fz, slowTo, pb.resume_rate, srcFps, fps);
    if (kSlow) segments.push({ kind: 'resume', moment: index, out0: n, out1: n + kSlow, src0: fz, src1: slowTo, rate: pb.resume_rate });
    n += kSlow;
    const kRest = playFrames(slowTo, outF, 1, srcFps, fps);
    if (kRest) segments.push({ kind: 'resume', moment: index, out0: n, out1: n + kRest, src0: slowTo, src1: outF, rate: 1 });
    n += kRest;
    rec.resume1 = n;
    // 4 — end hold on out_f with the outcome line
    const outcome = captionTexts(m.captions?.outcome ? [m.captions.outcome] : []);
    const outRead = readingSeconds(outcome, pb);
    const lead = Math.min(rec.resume1 - rec.resume0, secToFrames(outcome.length ? pb.outcome_lead_s : 0, fps));
    rec.outcome0 = outcome.length ? rec.resume1 - lead : null;
    const endHold = Math.max(secToFrames(pb.end_min_s, fps), secToFrames(outRead, fps) - lead);
    segments.push({ kind: 'end', moment: index, out0: n, out1: n + endHold, src0: outF, src1: outF, rate: 0 });
    n += endHold;
    rec.end1 = n;
    Object.assign(rec, { in_f: inF, freeze_f: fz, out_f: outF, slow_until_f: slowTo, hold_s: holdS });
    out.push(rec);
  });
  return { fps, srcFps, frames: n, segments, moments: out };
}

function int(v, name, m) {
  if (!Number.isInteger(v)) throw new Error(`breakdown: moment ${m?.id}: ${name} must be a whole source frame (got ${v})`);
  return v;
}

/** The segment holding output frame n (clamped to the plan). */
export function segmentAt(p, n) {
  const segs = p.segments;
  if (!segs.length) return null;
  if (n < segs[0].out0) return segs[0];
  // binary search: last segment with out0 <= n
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].out0 <= n) lo = mid; else hi = mid - 1;
  }
  return segs[lo];
}

/**
 * Source position at output frame n.
 *   pos:   continuous source frame (for smooth camera moves)
 *   frame: the integer source frame shown (sample-and-hold, never past src1)
 */
export function sourceAt(p, n) {
  const seg = segmentAt(p, n);
  if (!seg) return { pos: 0, frame: 0, seg: null };
  const k = Math.min(Math.max(0, n - seg.out0), Math.max(0, seg.out1 - seg.out0));
  if (seg.rate === 0) return { pos: seg.src0, frame: seg.src0, seg };
  if (n >= seg.out1) return { pos: seg.src1, frame: seg.src1, seg };
  const pos = Math.min(seg.src1, seg.src0 + k * step(seg.rate, p.srcFps, p.fps));
  return { pos, frame: Math.min(seg.src1, Math.floor(pos + EPS)), seg };
}

/** Moment record active at output frame n (the last one starting at or before n). */
export function momentAt(p, n) {
  let cur = p.moments[0] ?? null;
  for (const m of p.moments) if (m.out0 <= n) cur = m;
  return cur;
}

/** Output frame → seconds of the source (for timecode labels). */
export const sourceSeconds = (p, frame) => frame / p.srcFps;

/** m:ss.ss label for a source frame (seconds with hundredths, as in moments.md). */
export function timecode(frame, srcFps) {
  const cs = Math.round((frame / srcFps) * 100);
  const m = Math.floor(cs / 6000), rest = cs - m * 6000;
  const ss = Math.floor(rest / 100), hh = rest % 100;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(hh).padStart(2, '0')}`;
}
