// plan.mjs — the renderer's breakdown timing and track maths, for the Python tools,
// so the project builder and the review proofs use exactly what the scene renders.
//
//   node studio/footy/plan.mjs plan    < {clip, moments, fps, timing}  → plan (segments, moment records)
//   node studio/footy/plan.mjs sample  < {moments}                     → {moment: {track: {frame: [x, y]}}, bounds}

import { readFileSync } from 'node:fs';
import { plan } from '../../frontend/renderer/breakdown/timing.js';
import { sample, prepareTracks, annotationBounds } from '../../frontend/renderer/breakdown/keys.js';

const input = JSON.parse(readFileSync(0, 'utf8'));
const cmd = process.argv[2];
let out;
if (cmd === 'plan') {
  out = plan({ clip: input.clip, moments: input.moments, fps: input.fps, options: input.timing ?? {} });
} else if (cmd === 'sample') {
  out = { points: {}, bounds: {} };
  for (const m of input.moments ?? []) {
    const tracks = prepareTracks(m.tracks);
    const frames = new Set([m.in_f, m.freeze_f, m.out_f]);
    for (const t of Object.values(m.tracks ?? {})) for (const k of t.keys ?? []) frames.add(k.f);
    const per = {};
    for (const [id, t] of Object.entries(tracks)) {
      per[id] = {};
      for (const f of frames) {
        const s = sample(t, f);
        if (s) per[id][f] = [s.x, s.y, s.inRange];
      }
    }
    out.points[m.id] = per;
    out.bounds[m.id] = annotationBounds(m.annotations, tracks, m.freeze_f);
  }
} else {
  throw new Error(`unknown command ${cmd}`);
}
process.stdout.write(JSON.stringify(out));
