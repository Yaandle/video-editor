"""The daily episode file (`vidkit.daily-episode` v1) and T1: ingest + list.

One episode = one match. `ingest` reads an Aussie Rules 2 highlights export (a folder
with `moments.json`, `NN_<type>_9x16.avi`, `NN_<type>_16x9.avi` and `NN_<type>.replay`)
or a raw screen recording, makes frame-exact proxies under media/afl-daily/<slug>/clips/,
reads each replay's ball track, and writes media/afl-daily/<slug>/episode.json.

Nothing here guesses. A field the export doesn't have stays null and the moment gets a
flag; the list command prints the flags. Frames are proxy frames (30 fps, the export rate).
"""
from __future__ import annotations

import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .. import paths
from ..footy import media
from . import replay

SCHEMA = "vidkit.daily-episode"
VERSION = 1
EXPORT_FORMAT = "aussie-rules-2-highlights"
EXPORT_VERSIONS = {1}
ROOT = paths.MEDIA / "afl-daily"
SERIES = "making an AFL game every day until the AI can beat me"


# ── file helpers ─────────────────────────────────────────────────────────────

def load(path: Path) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("schema") != SCHEMA:
        raise ValueError(f"{path}: not a {SCHEMA} file")
    return data


def save(path: Path, data: dict) -> None:
    Path(path).write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def content_hash(data: dict) -> str:
    """sha256 of everything except the review block: any edit after approval voids it."""
    body = {k: v for k, v in data.items() if k != "review"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def slug_of(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "episode"


# ── who did it ───────────────────────────────────────────────────────────────

def sides(rows: list[dict]) -> dict:
    """Which side the human plays: the side of every player the export marks `human`.
    None if the export never marks one (then captions can't say "I" or "the AI")."""
    seen = {}
    for r in rows:
        for p in r.get("players") or []:
            if p.get("human") and p.get("side") in ("home", "away"):
                seen[p["side"]] = seen.get(p["side"], 0) + 1
    if len(seen) != 1:
        return {"me": None, "ai": None, "evidence": seen}
    me = next(iter(seen))
    return {"me": me, "ai": "away" if me == "home" else "home", "evidence": seen}


def actor(row: dict, sd: dict) -> str:
    """The moment's main player (the export lists them first): me, teammate (my side, AI
    controlled), ai, or unknown."""
    ps = row.get("players") or []
    if not ps or not sd.get("me"):
        return "unknown"
    p = ps[0]
    if p.get("human"):
        return "me"
    if p.get("side") == sd["ai"]:
        return "ai"
    if p.get("side") == sd["me"]:
        return "teammate"
    return "unknown"


def opponent_is_me(row: dict) -> bool:
    return any(p.get("human") and p.get("role") == "opponent" for p in row.get("players") or [])


# ── ingest: an AR2 export folder ─────────────────────────────────────────────

def _proxy(src: Path, out: Path) -> dict:
    if out.is_file():
        p = media.probe(out)
    else:
        p = media.make_proxy(src, out, keep_audio=True)
    return {"fps": media.fps_json(p["fps"]), "frames": int(p["frames"]), "width": p["width"], "height": p["height"],
            "audio_file": paths.rel(p["audio_file"]) if p.get("audio_file") else None}


def ingest_export(folder: Path, slug: str | None = None, day: int | None = None, workers: int = 4) -> Path:
    folder = Path(folder)
    mj = folder / "moments.json"
    if not mj.is_file():
        raise FileNotFoundError(f"{folder}: no moments.json (still exporting? a raw clip needs --raw)")
    doc = json.loads(mj.read_text(encoding="utf-8"))
    if doc.get("format") != EXPORT_FORMAT:
        raise ValueError(f"{mj}: format is {doc.get('format')!r}, expected {EXPORT_FORMAT!r}")
    rows = doc.get("moments") or []
    slug = slug or slug_of(folder.name)
    out = ROOT / slug
    (out / "clips").mkdir(parents=True, exist_ok=True)
    sd = sides(rows)
    fps_export = 30.0

    jobs = []
    for r in rows:
        files = r.get("files") or {}
        port = folder / files["portrait"] if files.get("portrait") else None
        jobs.append((r, port))

    def work(job):
        r, port = job
        if port is None or not port.is_file():
            return None
        return _proxy(port, out / "clips" / (port.stem + ".mp4"))

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        probes = list(ex.map(work, jobs))

    clips, moments = [], []
    for i, ((r, port), pr) in enumerate(zip(jobs, probes), 1):
        files = r.get("files") or {}
        cid, mid = f"c{i:02d}", f"m{i:02d}"
        flags = []
        rp = folder / files["replay"] if files.get("replay") else None
        clip = {"id": cid, "file": str(port) if port else None,
                "landscape": str(folder / files["landscape"]) if files.get("landscape") else None,
                "replay": str(rp) if rp else None, "proxy": None, "fps": None, "frames": None, "width": None, "height": None}
        if pr is None:
            flags.append("portrait clip missing: not in the folder")
        else:
            clip.update(proxy=paths.rel(out / "clips" / (port.stem + ".mp4")), fps=pr["fps"], frames=pr["frames"],
                        width=pr["width"], height=pr["height"])
            if pr.get("audio_file"):
                clip["audio_file"] = pr["audio_file"]
        fps = float(clip["fps"] or fps_export)
        ev = r.get("event_offset_s")
        event_f = int(round(float(ev) * fps)) if ev is not None else None
        if event_f is None:
            flags.append("no event_offset_s: the event frame is unknown")
        elif clip["frames"] and not (0 <= event_f < clip["frames"]):
            flags.append(f"event frame {event_f} is outside the clip ({clip['frames']} frames)")

        kick_f = leaves_f = reset_f = score_f = kick_dist = None
        jumps: list[int] = []
        if rp and rp.is_file() and event_f is not None:
            tr = replay.read(rp, fps)
            if clip["frames"] and abs(tr.frames - clip["frames"]) > 1:
                flags.append(f"replay has {tr.frames} frames, clip has {clip['frames']}")
            if r.get("type") in ("goal", "behind", "mark", "long_kick"):
                kick_f = tr.kick_before(event_f)
                if kick_f is None and r.get("type") in ("goal", "behind"):
                    flags.append("no kick found in the replay before the score: lead-in falls back to time")
            reset_f = tr.reset_after(event_f)
            jumps = tr.teleports(1, event_f)
            if r.get("type") in ("goal", "behind"):
                leaves_f = tr.leaves_after(event_f)
                score_f = tr.score_change(event_f)
                if score_f is None:
                    flags.append("the score doesn't change near the event in the replay")
                if kick_f is not None:
                    kick_dist = round(tr.ground_dist(kick_f, event_f), 1)
                    said = (r.get("facts") or {}).get("distance")
                    if said is not None and abs(float(said) - kick_dist) > max(8.0, 0.25 * float(said)):
                        flags.append(f"distance mismatch: the export says {float(said):.0f} m, but the scoring kick in "
                                     f"the replay travels about {kick_dist:.0f} m (the export's figure looks like an earlier kick's)")
            if jumps:
                flags.append(f"the ball resets mid-clip (frame {jumps[-1]}): the camera snaps there, so the cut starts after it")
        elif not (rp and rp.is_file()):
            flags.append("replay file missing: no ball track, cuts fall back to time")

        who = actor(r, sd)
        if who == "unknown":
            flags.append("main player unknown: caption can't say who")
        if not (r.get("caption") or "").strip():
            flags.append("no suggested caption")
        moments.append({
            "id": mid, "clip": cid, "rank": r.get("rank"), "type": r.get("type"), "label": r.get("label"),
            "game_clock": r.get("game_clock"), "quarter": r.get("quarter"), "match_time_s": r.get("match_time_s"),
            "event_f": event_f, "kick_f": kick_f, "leaves_f": leaves_f, "reset_f": reset_f, "score_f": score_f,
            "kick_dist_m": kick_dist, "jumps": jumps,
            "who": who, "opponent_is_me": opponent_is_me(r),
            "players": r.get("players") or [], "score_before": r.get("score_before"), "score_after": r.get("score_after"),
            "facts": r.get("facts") or {}, "game_caption": r.get("caption"), "highlight_score": r.get("highlight_score"),
            "human_involved": r.get("human_involved"), "camera": r.get("camera"),
            "caption": None, "caption_source": None, "flags": flags,
            "status": "candidate", "order": None, "in_f": None, "out_f": None, "slow": None,
        })
        clips.append(clip)

    ep = {
        "schema": SCHEMA, "version": VERSION, "series": SERIES, "day": day, "slug": slug,
        "source": {"kind": "ar2-export", "folder": str(folder), "format": doc.get("format"),
                   "format_version": doc.get("version"), "exported_at": doc.get("exported_at"),
                   "complete": (doc.get("output") or {}).get("complete"), "match": doc.get("match") or {}},
        "sides": sd, "clips": clips, "moments": moments,
        "closing": {"result": None, "verdict": None, "could": None, "couldnt": None, "next": None, "source": None},
        "music": None, "review": None,
    }
    if doc.get("version") not in EXPORT_VERSIONS:
        ep["warnings"] = [f"export version {doc.get('version')} is newer than this reader ({sorted(EXPORT_VERSIONS)})"]
    if not ep["source"]["complete"]:
        ep.setdefault("warnings", []).append("the export says it is not complete (cancelled?)")
    path = out / "episode.json"
    save(path, ep)
    return path


# ── ingest: a raw recording (no moments.json) ────────────────────────────────

def ingest_raw(file: Path, slug: str | None = None, day: int | None = None, max_n: int = 8) -> Path:
    """A raw OBS recording: proxy + audio, then motion/sound signals give candidate moments.
    Type and caption stay empty: you set them (the list flags every one)."""
    from ..footy import sheets, signals
    file = Path(file)
    slug = slug or slug_of(file.stem)
    out = ROOT / slug
    (out / "clips").mkdir(parents=True, exist_ok=True)
    proxy = out / "clips" / (slug_of(file.stem) + ".mp4")
    pr = _proxy(file, proxy)
    fps = float(pr["fps"])
    sig = signals.compute(proxy, fps, pr["width"], paths.ROOT / pr["audio_file"] if pr.get("audio_file") else None)
    cuts, shot_list = signals.shots(sig, fps)
    _score, cands = signals.candidates(sig, fps, shot_list, cuts, max_n=max_n)
    clip = {"id": "c01", "file": str(file), "landscape": None, "replay": None, "proxy": paths.rel(proxy),
            "fps": pr["fps"], "frames": pr["frames"], "width": pr["width"], "height": pr["height"], "audio_file": pr.get("audio_file")}
    moments = []
    for i, cd in enumerate(sorted(cands, key=lambda c: c["peak_f"]), 1):
        frames = sorted(set(range(cd["start_f"], cd["end_f"] + 1, max(1, (cd["end_f"] - cd["start_f"]) // 7))) | {cd["peak_f"]})
        sheet = sheets.contact_sheet(media.extract_frames(proxy, frames, fps), fps, out / "scan" / f"m{i:02d}-sheet.png",
                                     f"m{i:02d}  f{cd['start_f']}-f{cd['end_f']}  peak f{cd['peak_f']}")
        moments.append({
            "id": f"m{i:02d}", "clip": "c01", "rank": cd["rank"], "type": None, "label": None, "game_clock": None,
            "quarter": None, "match_time_s": round(cd["peak_f"] / fps, 2),
            "event_f": cd["peak_f"], "kick_f": None, "leaves_f": None, "reset_f": None, "score_f": None,
            "kick_dist_m": None, "jumps": [], "who": "unknown", "opponent_is_me": False, "players": [], "score_before": None, "score_after": None,
            "facts": {}, "game_caption": None, "highlight_score": cd["score"], "human_involved": None, "camera": None,
            "caption": None, "caption_source": None, "sheet": paths.rel(sheet),
            "flags": ["raw clip: set the type", "raw clip: write the caption (or pick a draft)",
                      "raw clip: who did it is unknown"],
            "status": "candidate", "order": None, "in_f": cd["start_f"], "out_f": cd["end_f"], "slow": None,
        })
    ep = {"schema": SCHEMA, "version": VERSION, "series": SERIES, "day": day, "slug": slug,
          "source": {"kind": "raw", "folder": str(file.parent), "format": None, "format_version": None,
                     "exported_at": None, "complete": True, "match": {}},
          "sides": {"me": None, "ai": None, "evidence": {}}, "clips": [clip], "moments": moments,
          "closing": {"result": None, "verdict": None, "could": None, "couldnt": None, "next": None, "source": None},
          "music": None, "review": None}
    path = out / "episode.json"
    save(path, ep)
    return path


# ── list ─────────────────────────────────────────────────────────────────────

def episode_flags(ep: dict) -> list[str]:
    out = list(ep.get("warnings") or [])
    if ep.get("day") is None:
        out.append("day number not set: `daily day <episode> N`")
    if ep["sides"].get("me") is None and ep["source"]["kind"] != "raw":
        out.append(f"can't tell which side you play (human players by side: {ep['sides'].get('evidence')})")
    return out


def table(ep: dict) -> str:
    fps = 30.0
    m0 = ep["source"].get("match") or {}
    fin = m0.get("final") or {}
    head = [f"{ep['slug']}  ·  {ep['source']['kind']}  ·  day {ep.get('day') or '?'}",
            f"match: {m0.get('home', '?')} {fin.get('home', '')} v {m0.get('away', '?')} {fin.get('away', '')}"
            f"  ·  you play {ep['sides'].get('me') or '?'}  ·  {len(ep['moments'])} moments"]
    rows = [("id", "st", "type", "clock", "who", "event", "clip", "score after", "caption (game's suggestion → series line)", "flags")]
    clips = {c["id"]: c for c in ep["clips"]}
    for m in sorted(ep["moments"], key=lambda m: (m.get("match_time_s") is None, m.get("match_time_s") or 0)):
        c = clips[m["clip"]]
        f = float(c["fps"] or fps)
        sa = m.get("score_after") or {}
        score = f"{sa.get('home', '')}–{sa.get('away', '')}" if sa else ""
        st = {"keep": "KEEP", "drop": "drop", "candidate": "·"}.get(m["status"], m["status"])
        cap = m.get("game_caption") or ""
        if m.get("caption"):
            cap = f"{cap} → {m['caption']}"
        rows.append((m["id"], st, m.get("type") or "?", m.get("game_clock") or "?", m["who"],
                     f"{m['event_f'] / f:.2f}s" if m.get("event_f") is not None else "?",
                     f"{(c['frames'] or 0) / f:.1f}s", score, cap, "; ".join(m["flags"]) or "–"))
    w = [max(len(str(r[i])) for r in rows) for i in range(len(rows[0]) - 2)]
    lines = head + [""]
    for r in rows:
        lines.append("  ".join(str(x).ljust(w[i]) for i, x in enumerate(r[:-2])) + "  " + r[-2] + ("" if r[-1] in ("–", "flags") else f"   [!] {r[-1]}"))
    ef = episode_flags(ep)
    if ef:
        lines += [""] + [f"[!] {x}" for x in ef]
    return "\n".join(lines)
