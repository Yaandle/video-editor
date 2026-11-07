// Footy breakdown: the timing plan (freezes land on the exact source frame, no
// drift) and keyframe interpolation for tracks that follow players.
import test from 'node:test';
import assert from 'node:assert/strict';

import { plan, sourceAt, segmentAt, playFrames, momentAt, readingSeconds, timecode, DEFAULTS } from '#renderer/breakdown/timing.js';
import { sample, normalizeKeys, smoother, resolvePoint, annotationBounds, prepareTracks } from '#renderer/breakdown/keys.js';
import { baseWindow, containWindow, fitWindow, followWindow, mapping } from '#renderer/breakdown/camera.js';

const moment = (o = {}) => ({ id: 'm1', in_f: 40, freeze_f: 160, out_f: 260, captions: { freeze: ['Two leads.', 'One space.'], outcome: 'The kick goes long.' }, annotations: [{}, {}], ...o });

/** Every output frame of a plan → the source frame it shows. */
const shown = (p) => Array.from({ length: p.frames }, (_, n) => sourceAt(p, n).frame);

for (const [label, srcFps] of [['25 fps', 25], ['50 fps', 50], ['29.97 fps', 30000 / 1001], ['30 fps', 30], ['60 fps', 60]]) {
  test(`freeze shows exactly freeze_f for the whole hold (${label} source, 30 fps out)`, () => {
    const p = plan({ clip: { fps: srcFps, frames: 400 }, moments: [moment()], fps: 30 });
    const m = p.moments[0];
    const frames = shown(p);
    for (let n = m.freeze0; n < m.hold1; n++) assert.equal(frames[n], 160, `output frame ${n}`);
    // the frame before the freeze is still before freeze_f, and playback never goes backwards
    assert.ok(frames[m.freeze0 - 1] < 160);
    for (let n = 1; n < m.resume1; n++) assert.ok(frames[n] >= frames[n - 1], `went backwards at ${n}`);
    // lead-in starts on in_f, the end hold shows out_f
    assert.equal(frames[m.out0], 40);
    for (let n = m.resume1; n < m.end1; n++) assert.equal(frames[n], 260);
  });

  test(`lead-in at 1x shows every source frame it should (${label})`, () => {
    const p = plan({ clip: { fps: srcFps, frames: 400 }, moments: [moment()], fps: 30 });
    const m = p.moments[0];
    for (let n = m.out0; n < m.freeze0; n++) {
      // sample-and-hold: frame shown is the latest source frame at or before output time
      const want = Math.floor(40 + ((n - m.out0) * srcFps) / 30 + 1e-7);
      assert.equal(sourceAt(p, n).frame, want, `output frame ${n}`);
    }
  });
}

test('the freeze lands on the first output frame at which the playhead reaches freeze_f', () => {
  // 25 → 30 fps: 120 source frames take exactly 144 output frames
  assert.equal(playFrames(40, 160, 1, 25, 30), 144);
  // 121 source frames: 145.2 → 146 output frames (the freeze cannot land early)
  assert.equal(playFrames(40, 161, 1, 25, 30), 146);
  const p = plan({ clip: { fps: 25, frames: 400 }, moments: [moment()], fps: 30 });
  assert.equal(p.moments[0].freeze0, 144);
  assert.equal(sourceAt(p, 143).frame, 159);
  assert.equal(sourceAt(p, 144).frame, 160);
});

test('no drift: long clip, many moments, every freeze still exact', () => {
  const srcFps = 30000 / 1001;
  const moments = [];
  for (let i = 0; i < 12; i++) moments.push(moment({ id: `m${i}`, in_f: 1000 * i + 7, freeze_f: 1000 * i + 613, out_f: 1000 * i + 977 }));
  const p = plan({ clip: { fps: srcFps, frames: 13000 }, moments, fps: 30 });
  for (const m of p.moments) {
    assert.equal(sourceAt(p, m.freeze0).frame, m.freeze_f);
    assert.equal(sourceAt(p, m.hold1 - 1).frame, m.freeze_f);
    assert.ok(sourceAt(p, m.freeze0 - 1).frame < m.freeze_f);
    assert.equal(sourceAt(p, m.end1 - 1).frame, m.out_f);
  }
  // segments tile the output with no gaps or overlaps
  for (let i = 1; i < p.segments.length; i++) assert.equal(p.segments[i].out0, p.segments[i - 1].out1);
  assert.equal(p.segments.at(-1).out1, p.frames);
});

test('slow-motion resume starts on the freeze frame and reaches slow_until_f, then 1x to out_f', () => {
  const p = plan({ clip: { fps: 25, frames: 400 }, moments: [moment({ slow_until_f: 200, playback: { resume_rate: 0.5 } })], fps: 30 });
  const m = p.moments[0];
  assert.equal(sourceAt(p, m.resume0).frame, 160);
  const slow = p.segments.find((s) => s.kind === 'resume' && s.rate === 0.5);
  const fast = p.segments.find((s) => s.kind === 'resume' && s.rate === 1);
  assert.equal(slow.out1 - slow.out0, playFrames(160, 200, 0.5, 25, 30));   // 40 src frames at 0.5x → 96 frames
  assert.equal(slow.out1 - slow.out0, 96);
  assert.equal(sourceAt(p, fast.out0).frame, 200);
  assert.equal(sourceAt(p, m.resume1).frame, 260);
});

test('hold length: reading time, at least the voice line, clamped', () => {
  const fps = 30;
  const p = plan({ clip: { fps: 25, frames: 400 }, moments: [moment()], fps });
  const m = p.moments[0];
  const read = readingSeconds(['Two leads.', 'One space.'], DEFAULTS) + 2 * DEFAULTS.per_annotation_s;
  const want = Math.max(DEFAULTS.hold_min_s, Math.min(DEFAULTS.hold_max_s, read));
  assert.equal(m.hold1 - m.freeze0, Math.round((DEFAULTS.settle_s + want) * fps));
  const pv = plan({ clip: { fps: 25, frames: 400 }, moments: [moment({ voice_s: 7.5 })], fps });
  assert.equal(pv.moments[0].hold1 - pv.moments[0].freeze0, Math.round((DEFAULTS.settle_s + 7.5 + 2 * DEFAULTS.voice_pad_s) * fps));
  const ph = plan({ clip: { fps: 25, frames: 400 }, moments: [moment({ playback: { hold_s: 5 } })], fps });
  assert.equal(ph.moments[0].hold1 - ph.moments[0].freeze0, Math.round((DEFAULTS.settle_s + 5) * fps));
});

test('bad moments are rejected, not silently clamped', () => {
  const clip = { fps: 25, frames: 300 };
  assert.throws(() => plan({ clip, moments: [moment({ freeze_f: 20 })], fps: 30 }), /in_f <= freeze_f <= out_f/);
  assert.throws(() => plan({ clip, moments: [moment({ out_f: 300 })], fps: 30 }), /outside the clip/);
  assert.throws(() => plan({ clip, moments: [moment({ freeze_f: 160.5 })], fps: 30 }), /whole source frame/);
  assert.throws(() => plan({ clip: { fps: 0 }, moments: [moment()], fps: 30 }), /clip.fps/);
});

test('two moments run back to back; momentAt and segmentAt agree', () => {
  const p = plan({ clip: { fps: 25, frames: 600 }, moments: [moment(), moment({ id: 'm2', in_f: 300, freeze_f: 380, out_f: 450 })], fps: 30 });
  const [a, b] = p.moments;
  assert.equal(b.out0, a.end1);
  assert.equal(momentAt(p, a.end1 - 1).id, 'm1');
  assert.equal(momentAt(p, b.out0).id, 'm2');
  assert.equal(segmentAt(p, b.freeze0).kind, 'freeze');
  assert.equal(sourceAt(p, b.freeze0).frame, 380);
});

test('timecode labels', () => {
  assert.equal(timecode(0, 25), '00:00.00');
  assert.equal(timecode(96, 25), '00:03.84');            // seconds and hundredths, not frames
  assert.equal(timecode(25 * 61 + 3, 25), '01:01.12');
  assert.equal(timecode(1798, 30000 / 1001), '00:59.99');   // 1798 / 29.97 = 59.993 s
});

// ── keyframes ────────────────────────────────────────────────────────────────

const keys = [{ f: 100, x: 0, y: 0 }, { f: 110, x: 100, y: 50 }, { f: 130, x: 100, y: 250 }];

test('every interpolation passes exactly through its keys', () => {
  for (const interp of ['smooth', 'ease', 'linear', 'hold']) {
    for (const k of keys) {
      const s = sample({ keys, interp }, k.f);
      assert.equal(s.x, k.x, `${interp} x @${k.f}`);
      assert.equal(s.y, k.y, `${interp} y @${k.f}`);
    }
  }
});

test('linear, ease and hold midpoints', () => {
  assert.deepEqual([sample({ keys, interp: 'linear' }, 105).x, sample({ keys, interp: 'linear' }, 105).y], [50, 25]);
  // smootherstep is symmetric: half way in time is half way in space, but slower at the ends
  assert.equal(sample({ keys, interp: 'ease' }, 105).x, 50);
  assert.ok(sample({ keys, interp: 'ease' }, 101).x < 10 * 0.5);
  assert.equal(sample({ keys, interp: 'hold' }, 109).x, 0);
  assert.equal(sample({ keys, interp: 'hold' }, 110).x, 100);
  assert.equal(smoother(0), 0);
  assert.equal(smoother(1), 1);
  assert.equal(smoother(0.5), 0.5);
});

test('smooth (Catmull-Rom) eases in and out at the ends and is continuous through keys', () => {
  const t = { keys, interp: 'smooth' };
  // zero velocity at the first key: the first step is smaller than linear's
  assert.ok(sample(t, 101).x < 10);
  // velocity is continuous through the middle key (left and right difference quotients agree)
  const h = 1e-3;
  const vl = (sample(t, 110).y - sample(t, 110 - h).y) / h;
  const vr = (sample(t, 110 + h).y - sample(t, 110).y) / h;
  assert.ok(Math.abs(vl - vr) < 0.05, `${vl} vs ${vr}`);
});

test('tracks hold their end keys outside the range and flag it', () => {
  const a = sample({ keys }, 50), b = sample({ keys }, 500);
  assert.deepEqual([a.x, a.y, a.inRange], [0, 0, false]);
  assert.deepEqual([b.x, b.y, b.inRange], [100, 250, false]);
  assert.equal(sample({ keys }, 120).inRange, true);
});

test('keys are sorted and de-duplicated; dense CV samples with boxes interpolate too', () => {
  const k = normalizeKeys([{ f: 10, x: 1, y: 1 }, { f: 5, x: 0, y: 0 }, { f: 10, x: 2, y: 2 }, { f: 'x' }]);
  assert.deepEqual(k.map((q) => [q.f, q.x]), [[5, 0], [10, 2]]);
  const dense = Array.from({ length: 11 }, (_, i) => ({ f: i, x: i * 3, y: 0, w: 40 + i, h: 80, conf: 0.9 - i * 0.01 }));
  const s = sample({ keys: dense, interp: 'linear' }, 4.5);
  assert.equal(s.x, 13.5);
  assert.equal(s.w, 44.5);
  assert.ok(Math.abs(s.conf - 0.85) < 1e-9);    // between samples, the lower confidence of the two
});

test('point refs: fixed, on a track, with offsets; bounds include ring radius', () => {
  const tracks = prepareTracks({ p1: { keys } });
  assert.deepEqual(resolvePoint({ x: 5, y: 6 }, tracks, 0), { x: 5, y: 6, inRange: true });
  const p = resolvePoint({ track: 'p1', dx: 10, dy: -5 }, tracks, 110);
  assert.deepEqual([p.x, p.y], [110, 45]);
  assert.equal(resolvePoint({ track: 'nope' }, tracks, 110), null);
  const b = annotationBounds([{ kind: 'ring', track: 'p1', r: 30 }], tracks, 110);
  assert.deepEqual(b, { x0: 70, y0: 20, x1: 130, y1: 80 });
});

// ── camera ───────────────────────────────────────────────────────────────────

test('camera windows: crop for a tall panel, letterbox when the marks are too wide', () => {
  const src = { w: 1280, h: 720 };
  assert.equal(baseWindow(src, 16 / 9).w, 1280);
  assert.equal(baseWindow(src, 1).w, 720);          // square panel crops the sides
  assert.equal(containWindow(src, 1).w, 1280);      // whole frame letterboxed top/bottom
  // marks 1000 px apart cannot fit a 720-wide crop: the window widens to hold them
  const wide = fitWindow({ x0: 100, y0: 300, x1: 1100, y1: 400 }, src, 1, { margin: 0 });
  assert.equal(wide.w, 1000);
  // a small cluster zooms in no further than maxZoom
  const tight = fitWindow({ x0: 600, y0: 300, x1: 640, y1: 340 }, src, 1, { maxZoom: 1.6 });
  assert.equal(tight.w, 720 / 1.6);
  // a follow window near the edge is clamped onto the video
  const f = followWindow({ x: 20, y: 360 }, src, 1);
  assert.equal(f.cx, 360);
  const m = mapping({ cx: 640, cy: 360, w: 1280 }, { x: 0, y: 0, w: 640, h: 360 });
  assert.deepEqual(m.toPanel(1280, 720), { x: 640, y: 360 });
});
