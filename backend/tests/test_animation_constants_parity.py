"""
canvas.js and text_anim.py hand-duplicate every narration animation default
(no shared schema â€” see README.md's "Animation sync requirement"), and they
have already drifted once in production: issue #65 was a wrap-ratio constant
(0.85 vs 0.88) silently diverging between the two files. These tests read
both files' source text directly and assert the two independently-maintained
copies of each shared constant still agree, to catch that exact class of bug
automatically instead of relying on developer discipline alone.
"""
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CANVAS_JS = REPO_ROOT / "frontend" / "canvas.js"
TEXT_ANIM_PY = REPO_ROOT / "backend" / "text_anim.py"

# (style, JS render function, Python render function, shared default fields)
STYLE_FIELDS = [
    ("typewriter", "_renderNarrationTypewriter", "render_narration_typewriter",
     ["text_chars_per_second", "text_pop_duration_ms"]),
    ("wordblurin", "_renderNarrationWordBlurIn", "render_narration_wordblurin",
     ["text_stagger_ms", "text_duration_ms", "text_max_blur", "text_rise_distance"]),
    ("linescan", "_renderNarrationLineScan", "render_narration_linescan",
     ["text_duration_ms", "text_line_stagger_ms", "text_slide_distance", "text_sweep_width"]),
    ("fade", "_renderNarrationFadeIn", "render_narration_fade", ["text_duration_ms"]),
    ("slideup", "_renderNarrationSlideUp", "render_narration_slideup",
     ["text_duration_ms", "text_rise_distance"]),
    ("scalepop", "_renderNarrationScalePop", "render_narration_scalepop", ["text_duration_ms"]),
    ("charstagger", "_renderNarrationCharStagger", "render_narration_charstagger",
     ["text_stagger_ms", "text_duration_ms", "text_rise_distance"]),
    ("glitch", "_renderNarrationGlitch", "render_narration_glitch", ["text_duration_ms"]),
]


def _extract_function_body(source, start_pattern, next_pattern):
    m = re.search(start_pattern, source)
    assert m, f"could not find {start_pattern!r} in source"
    rest = source[m.end():]
    next_m = re.search(next_pattern, rest)
    end = m.end() + (next_m.start() if next_m else len(rest))
    return source[m.start():end]


def _js_default(body, field, style):
    m = re.search(rf'clip\.{field}\s*\?\?\s*(-?[\d.]+)', body)
    assert m, f"canvas.js: no default for {field!r} found in {style} render function"
    return float(m.group(1))


def _py_default(body, field, style):
    m = re.search(rf'params\.get\(\s*"{field}"\s*,\s*(-?[\d.]+)\s*\)', body)
    assert m, f"text_anim.py: no default for {field!r} found in {style} render function"
    return float(m.group(1))


def test_narration_style_defaults_match_between_canvas_js_and_text_anim_py():
    js_source = CANVAS_JS.read_text(encoding="utf8")
    py_source = TEXT_ANIM_PY.read_text(encoding="utf8")

    mismatches = []
    for style, js_fn, py_fn, fields in STYLE_FIELDS:
        js_body = _extract_function_body(
            js_source, rf'\n  {js_fn}\(', r'\n  _renderNarration'
        )
        py_body = _extract_function_body(
            py_source, rf'def {py_fn}\(', r'\ndef render_narration_'
        )
        for field in fields:
            js_val = _js_default(js_body, field, style)
            py_val = _py_default(py_body, field, style)
            if js_val != py_val:
                mismatches.append(f"{style}.{field}: canvas.js={js_val} vs text_anim.py={py_val}")

    assert not mismatches, "narration default drift:\n" + "\n".join(mismatches)


def test_narration_wrap_ratio_matches_between_canvas_js_and_text_anim_py():
    """The exact constant that drifted in issue #65."""
    js_source = CANVAS_JS.read_text(encoding="utf8")
    py_source = TEXT_ANIM_PY.read_text(encoding="utf8")

    js_ratios = {float(m) for m in re.findall(r'r\.w\s*\*\s*([\d.]+)\)\s*\|\s*0', js_source)}
    assert js_ratios == {0.88}, f"canvas.js wrap ratio inconsistent across call sites: {js_ratios}"

    py_match = re.search(r'canvas_w\s*\*\s*([\d.]+)\s*\)', py_source)
    assert py_match, "could not find text_anim.py's wrap-ratio expression"
    assert float(py_match.group(1)) == 0.88, (
        f"text_anim.py wrap ratio = {py_match.group(1)}, expected 0.88 to match canvas.js"
    )

