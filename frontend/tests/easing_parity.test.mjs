// Checks canvas.js's real Easing object against the same golden table
// backend/tests/test_easing_parity.py checks text_anim.Easing against, so
// both languages are proven consistent with one source of truth.
//
// canvas.js circularly imports app.js (for THEMES/TRACK_COLOURS), and
// app.js's bottom-level bootstrap does `window.addEventListener(...)` — a
// harmless top-level side effect in a browser, but it needs a `window`
// global to exist at all under Node. This stub is the only thing standing
// between this test and importing the production file directly instead of
// a hand-copied duplicate that could itself drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// canvas.js circularly imports app.js (for THEMES/TRACK_COLOURS), and
// app.js's bottom-level bootstrap does `window.addEventListener(...)` — a
// harmless top-level side effect in a browser, but it needs a `window`
// global to exist at all under Node. Static `import` is hoisted above any
// plain statement, so this stub must go through a dynamic import() instead —
// the only thing standing between this test and importing the production
// file directly instead of a hand-copied duplicate that could itself drift.
globalThis.window ??= { addEventListener() {} };
const { Easing } = await import('../canvas.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', '..', 'backend', 'tests', 'fixtures', 'easing_golden.json');
const { cases } = JSON.parse(readFileSync(fixturePath, 'utf8'));

const EPS = 1e-9;

test('canvas.js Easing matches golden values', () => {
  for (const c of cases) {
    const actual = c.fn === 'easeOutBack'
      ? Easing.easeOutBack(c.t, c.overshoot)
      : Easing[c.fn](c.t);
    assert.ok(
      Math.abs(actual - c.expected) < EPS,
      `${c.fn}(t=${c.t}${c.overshoot !== undefined ? `, overshoot=${c.overshoot}` : ''}) = ${actual}, expected ${c.expected}`
    );
  }
});
