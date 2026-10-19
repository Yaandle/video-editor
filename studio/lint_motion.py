"""Motion lint — fails the build on time-based animation that is not a pure
function of t. Scans the renderer (all scene and component code) and the
render harness.

    python -m studio.lint_motion            (exit 1 on any violation)

Forbidden: CSS transition/animation/@keyframes/cubic-bezier/ease-*,
setTimeout/setInterval/requestAnimationFrame, Date.now/performance.now/new Date,
Math.random (non-deterministic). Comments and string contents are ignored for
JS keywords; CSS rules are matched inside <style> blocks and style strings.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from . import paths

TARGETS = [paths.RENDERER, paths.FRONTEND / "render.html"]

JS_RULES = [
    (r"\bsetTimeout\s*\(", "setTimeout drives time — use a function of t"),
    (r"\bsetInterval\s*\(", "setInterval drives time — use a function of t"),
    (r"\brequestAnimationFrame\s*\(", "requestAnimationFrame timing is wall-clock"),
    (r"\bDate\.now\s*\(", "Date.now is wall-clock"),
    (r"\bperformance\.now\s*\(", "performance.now is wall-clock"),
    (r"\bnew\s+Date\s*\(", "new Date() is wall-clock"),
    (r"\bMath\.random\s*\(", "Math.random is non-deterministic — use motion.hash1(seed, n)"),
    (r"\.animate\s*\(", "Web Animations API is time-driven"),
]
CSS_RULES = [
    (r"\btransition\s*:", "CSS transition"),
    (r"\banimation(-name|-duration)?\s*:", "CSS animation"),
    (r"@keyframes\b", "@keyframes"),
    (r"cubic-bezier\s*\(", "cubic-bezier easing"),
    (r"\bease-(in|out|in-out)\b", "CSS easing keyword"),
    (r"\bsteps\s*\(\s*\d", "CSS steps() timing"),
]
# CSS-ish text can also hide in JS strings (element.style.transition = …).
STYLE_PROP_RULES = [
    (r"\.style\.(transition|animation)\w*\s*=", "inline CSS transition/animation"),
    (r"['\"](transition|animation)['\"]\s*,", "setProperty transition/animation"),
]


def strip_js(src: str) -> str:
    """Blank out comments and string literals, keeping line structure."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if src.startswith("//", i):
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i)); i = j
        elif src.startswith("/*", i):
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(re.sub(r"[^\n]", " ", src[i:j])); i = j
        elif c in "'\"`":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            j = min(n, j + 1)
            out.append(c + re.sub(r"[^\n]", " ", src[i + 1:j - 1]) + c); i = j
        else:
            out.append(c); i += 1
    return "".join(out)


def lint_text(name: str, text: str) -> list[str]:
    problems = []
    is_html = name.endswith(".html")
    css_blocks = re.findall(r"<style[^>]*>(.*?)</style>", text, re.S | re.I) if is_html else []
    scripts = re.findall(r"<script[^>]*>(.*?)</script>", text, re.S | re.I) if is_html else [text]
    css_text = "\n".join(css_blocks) + "\n" + "\n".join(re.findall(r'style="([^"]*)"', text))
    for pat, why in CSS_RULES:
        for m in re.finditer(pat, css_text, re.I):
            problems.append(f"{name}: {why} — '{m.group(0)}'")
    for script in scripts:
        code = strip_js(script)
        for pat, why in JS_RULES + STYLE_PROP_RULES:
            for m in re.finditer(pat, code):
                line = script[:m.start()].count("\n") + 1
                problems.append(f"{name}:{line}: {why} — '{m.group(0).strip()}'")
        # CSS keywords smuggled inside JS string literals (e.g. "ease-in-out")
        for m in re.finditer(r"(['\"`])((?:(?!\1).)*?)\1", script):
            lit = m.group(2)
            for pat, why in CSS_RULES:
                if re.search(pat, lit, re.I):
                    line = script[:m.start()].count("\n") + 1
                    problems.append(f"{name}:{line}: {why} inside a string — '{lit[:40]}'")
    return problems


def files() -> list[Path]:
    out = []
    for t in TARGETS:
        if t.is_dir():
            out += sorted(p for p in t.rglob("*") if p.suffix in (".js", ".mjs", ".html", ".css"))
        elif t.is_file():
            out.append(t)
    return out


def run() -> tuple[int, list[str]]:
    problems = []
    fs = files()
    for f in fs:
        problems += lint_text(paths.rel(f), f.read_text(encoding="utf-8"))
    return len(fs), problems


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    n, problems = run()
    if problems:
        print(f"motion lint: FAIL — {len(problems)} problem(s) in {n} files")
        for p in problems:
            print("  ✗ " + p)
        return 1
    print(f"motion lint: pass — {n} files, no time-driven animation")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
