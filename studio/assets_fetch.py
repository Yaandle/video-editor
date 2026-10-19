"""Fetch licence-clear photography from Wikimedia Commons into assets/images/.

Repeatable: `python -m studio.assets_fetch` (add --query "…" --count N for more).
Every file is logged in assets/MANIFEST.json with source URL, author, licence,
licence URL and a sha256. Only CC0 / public domain / CC BY / CC BY-SA files are
accepted. Nothing is faked: if a download fails it is reported and skipped.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
from datetime import datetime, timezone

from . import paths

API = "https://commons.wikimedia.org/w/api.php"
UA = "vidkit-studio/2.0 (local video editor asset fetch; contact: local user)"
OK_LICENCE = re.compile(r"^(cc0|public domain|pd\b|pd-|cc by(-sa)? ?\d(\.\d)?)", re.I)

# Curated searches for the showcase and scene templates. slug -> (query, count)
DEFAULT_QUERIES = {
    "barbican": ("Barbican Estate towers concrete", 4),
    "letterpress": ("letterpress wood type", 4),
    "film-editing": ("Steenbeck film editing table", 3),
    "metronome": ("metronome", 3),
    "skate": ("skateboarder ramp", 4),
    "mixing-desk": ("audio mixing console", 3),
    "concrete-texture": ("concrete wall texture", 3),
    "paper-texture": ("paper texture", 3),
}


def _get(url: str, timeout: int = 60, tries: int = 5) -> bytes:
    """GET with polite exponential backoff on HTTP 429 (Wikimedia rate limit)."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == tries - 1:
                raise
            time.sleep(4 * 2 ** attempt)
    raise RuntimeError("unreachable")


def _strip(s: str | None) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def search(query: str, limit: int = 20) -> list[dict]:
    params = {
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": "6",
        "gsrsearch": f"{query} filetype:bitmap", "gsrlimit": str(limit),
        "prop": "imageinfo", "iiprop": "url|size|extmetadata|mime", "iiurlwidth": "1920",
    }
    data = json.loads(_get(API + "?" + urllib.parse.urlencode(params)))
    pages = sorted(data.get("query", {}).get("pages", {}).values(), key=lambda p: p.get("index", 0))
    out = []
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata", {})
        lic = _strip(meta.get("LicenseShortName", {}).get("value"))
        if not OK_LICENCE.match(lic or ""):
            continue
        if ii.get("mime") not in ("image/jpeg", "image/png"):
            continue
        if (ii.get("width") or 0) < 1600 or (ii.get("height") or 0) < 1000:
            continue
        out.append({
            "title": p.get("title"),
            "file_page": ii.get("descriptionurl"),
            "source_url": ii.get("url"),
            "download_url": ii.get("thumburl") or ii.get("url"),
            "width": ii.get("width"), "height": ii.get("height"),
            "author": _strip(meta.get("Artist", {}).get("value")) or "unknown",
            "credit": _strip(meta.get("Credit", {}).get("value")),
            "license": lic,
            "license_url": _strip(meta.get("LicenseUrl", {}).get("value")) or None,
            "description": _strip(meta.get("ImageDescription", {}).get("value"))[:240],
        })
    return out


def load_manifest() -> dict:
    if paths.MANIFEST.is_file():
        return json.loads(paths.MANIFEST.read_text(encoding="utf-8"))
    return {"version": 1, "fonts": [], "icons": [], "images": []}


def save_manifest(m: dict) -> None:
    paths.MANIFEST.write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def fetch(queries: dict[str, tuple[str, int]]) -> int:
    paths.IMAGES.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    have = {i["source_url"] for i in manifest["images"]}
    failures = 0
    for slug, (query, count) in queries.items():
        try:
            hits = search(query)
        except Exception as exc:  # network / API failure is reported, never faked
            print(f"[fetch] search failed for {query!r}: {exc}", file=sys.stderr)
            failures += 1
            continue
        got = 0
        for h in hits:
            if got >= count:
                break
            if h["source_url"] in have:
                got += 1
                continue
            taken = {i["file"] for i in manifest["images"]}
            n = 1
            while paths.rel(paths.IMAGES / f"{slug}-{n:02d}.jpg") in taken:
                n += 1
            name = f"{slug}-{n:02d}.jpg"
            dest = paths.IMAGES / name
            try:
                data = _get(h["download_url"], timeout=120)
            except Exception as exc:
                print(f"[fetch] download failed {h['download_url']}: {exc}", file=sys.stderr)
                failures += 1
                continue
            dest.write_bytes(data)
            entry = {
                "file": paths.rel(dest), "slug": slug, "query": query,
                **{k: h[k] for k in ("title", "file_page", "source_url", "author", "credit", "license", "license_url", "description", "width", "height")},
                "downloaded_from": h["download_url"],
                "sha256": hashlib.sha256(data).hexdigest(),
                "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
            manifest["images"] = [i for i in manifest["images"] if i["file"] != entry["file"]] + [entry]
            have.add(h["source_url"])
            got += 1
            print(f"[fetch] {name}  {h['license']}  {h['author'][:40]}")
            time.sleep(2.0)
        if got < count:
            print(f"[fetch] only {got}/{count} licence-clear results for {query!r}")
    save_manifest(manifest)
    return failures


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--query", help="custom search query")
    ap.add_argument("--slug", default="custom")
    ap.add_argument("--count", type=int, default=3)
    a = ap.parse_args(argv)
    queries = {a.slug: (a.query, a.count)} if a.query else DEFAULT_QUERIES
    return 1 if fetch(queries) else 0


if __name__ == "__main__":
    raise SystemExit(main())
