"""Headless Chromium harness: loads frontend/render.html with the project and
serves every file from disk through request routing (no server, no network).

Hard failures (raised as HarnessError): console errors, uncaught page errors,
failed or unknown requests, renderer load errors, missing fonts/assets.
"""
from __future__ import annotations

import asyncio
import json
import mimetypes
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path

from .. import paths
from . import vframes

ORIGIN = "http://vidkit.local"
PAINT_BARRIER = "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))"

MIME = {".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".html": "text/html",
        ".css": "text/css", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2", ".otf": "font/otf",
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
        ".mp4": "video/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg"}

ROOTS = {"assets": paths.ASSETS, "design": paths.DESIGN, "media": paths.MEDIA, "projects": paths.PROJECTS}


class HarnessError(RuntimeError):
    pass


def resolve_url(url: str) -> Path | None:
    """Map a harness URL to a file under the project, refusing traversal."""
    parsed = urllib.parse.urlparse(url)
    rel = urllib.parse.unquote(parsed.path).lstrip("/")
    head = rel.split("/", 1)[0]
    base = ROOTS.get(head)
    if base is not None:
        target = (base.parent / rel).resolve()
        root = base.resolve()
    else:
        target = (paths.FRONTEND / rel).resolve()
        root = paths.FRONTEND.resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return None
    return target if target.is_file() else None


@dataclass
class Page:
    page: object
    context: object
    errors: list = field(default_factory=list)

    def check(self):
        if self.errors:
            raise HarnessError("; ".join(self.errors[:5]) + (f" (+{len(self.errors) - 5} more)" if len(self.errors) > 5 else ""))


async def _route(route, request, errors):
    url = request.url
    if not url.startswith(ORIGIN):
        errors.append(f"blocked external request: {url}")
        await route.abort()
        return
    parsed = urllib.parse.urlparse(url)
    if parsed.path == "/api/vframe":
        q = urllib.parse.parse_qs(parsed.query)
        try:
            png = await asyncio.to_thread(vframes.frame_path, q["src"][0], float(q["fps"][0]), int(q["frame"][0]))
        except Exception as exc:  # report, never substitute
            errors.append(f"video frame failed: {exc}")
            await route.fulfill(status=500, body=str(exc))
            return
        await route.fulfill(path=str(png), headers={"content-type": "image/png"})
        return
    path = resolve_url(url)
    if path is None:
        errors.append(f"404 {parsed.path}")
        await route.fulfill(status=404, body="not found")
        return
    ctype = MIME.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    await route.fulfill(path=str(path), headers={"content-type": ctype, "cache-control": "no-store"})


async def open_page(browser, width: int, height: int) -> Page:
    context = await browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1)
    page = await context.new_page()
    holder = Page(page=page, context=context)
    page.on("console", lambda m: holder.errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: holder.errors.append(f"page error: {e}"))
    page.on("requestfailed", lambda r: holder.errors.append(f"request failed: {r.url} {r.failure}"))
    await context.route("**/*", lambda route, request: _route(route, request, holder.errors))
    await page.goto(f"{ORIGIN}/render.html", wait_until="load")
    await page.wait_for_function("window.__harness === 'ready'", timeout=30000)
    holder.check()
    return holder


async def load_project(h: Page, project: dict, width: int, height: int) -> dict:
    tokens = json.loads(paths.TOKENS.read_text(encoding="utf-8"))
    try:
        res = await h.page.evaluate(
            "([p, o]) => window.__load(p, o)",
            [project, {"width": width, "height": height, "base": f"{ORIGIN}/", "tokens": tokens}],
        )
    except Exception as exc:
        raise HarnessError(f"renderer load failed: {exc}") from exc
    h.check()
    return res


async def seek(h: Page, t: float) -> dict:
    report = await h.page.evaluate("t => window.__seek(t)", t)
    await h.page.evaluate(PAINT_BARRIER)
    h.check()
    return report


async def capture_png(h: Page) -> bytes:
    return await h.page.screenshot(type="png", animations="disabled", caret="hide", scale="css")


async def events(h: Page) -> dict:
    return await h.page.evaluate("() => window.__events()")
