"""T6: the review gate. `review` writes review.md and a contact sheet per kept moment;
`approve` records who approved and a hash of the whole episode; the final build refuses
unless that approval is current. Claude never runs `approve`: it's the user's step.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from .. import paths
from ..footy import media, sheets
from . import cut
from . import episode as E


def require_approved(ep: dict) -> None:
    rv = ep.get("review") or {}
    if rv.get("status") != "approved":
        raise PermissionError("not approved: read review.md, then `python -m studio.daily approve <episode> --by <you>`")
    if rv.get("hash") != E.content_hash(ep):
        raise PermissionError("the episode changed after it was approved: review it again and re-approve")


def is_approved(ep: dict) -> bool:
    try:
        require_approved(ep)
        return True
    except PermissionError:
        return False


def approve(path: Path, by: str, notes: str = "") -> dict:
    ep = E.load(path)
    problems = blockers(ep)
    if problems:
        raise ValueError("can't approve yet:\n  " + "\n  ".join(problems))
    ep["review"] = {"status": "approved", "by": by, "at": datetime.now().isoformat(timespec="seconds"),
                    "hash": E.content_hash(ep), "notes": notes}
    E.save(path, ep)
    return ep["review"]


def blockers(ep: dict) -> list[str]:
    out = []
    if ep.get("day") is None:
        out.append("no day number")
    kept = [m for m in ep["moments"] if m["status"] == "keep"]
    if not kept:
        out.append("no moments kept")
    for m in kept:
        if not (m.get("caption") or "").strip():
            out.append(f"{m['id']}: no caption")
    c = ep.get("closing") or {}
    if not c.get("result"):
        out.append("closing card has no result line")
    return out


def _tc(f: int, fps: float) -> str:
    return f"{f / fps:.2f}s"


def write(path: Path) -> Path:
    ep = E.load(path)
    folder = path.parent / "review"
    folder.mkdir(exist_ok=True)
    clips = {c["id"]: c for c in ep["clips"]}
    kept = sorted([m for m in ep["moments"] if m["status"] == "keep"], key=lambda m: m["order"])
    fin = (ep["source"].get("match") or {}).get("final") or {}
    L = [f"# Review: day {ep.get('day') or '?'} · {ep['slug']}", "",
         f"Source: `{ep['source']['folder']}` ({ep['source']['kind']}, exported {ep['source'].get('exported_at')})  ",
         f"Final: {(ep['source'].get('match') or {}).get('home', '?')} {fin.get('home', '')} v "
         f"{(ep['source'].get('match') or {}).get('away', '?')} {fin.get('away', '')} · you play **{ep['sides'].get('me')}**  ",
         f"Length: about {(ep.get('cut') or {}).get('total_s', '?')} s · status: "
         + ("**approved** by " + ep["review"]["by"] if is_approved(ep) else "**not approved** (renders are stamped DRAFT)"), ""]
    b = blockers(ep)
    if b:
        L += ["**Blocking approval:**", *[f"- {x}" for x in b], ""]
    L += ["## Kept moments, in order", ""]
    for m in kept:
        c = clips[m["clip"]]
        fps = float(c["fps"])
        frames = sorted({m["in_f"], (m["in_f"] + m["event_f"]) // 2, m["event_f"], m["out_f"]})
        imgs = media.extract_frames(paths.ROOT / c["proxy"], frames, fps)
        sheet = sheets.contact_sheet(imgs, fps, folder / f"{m['id']}.png",
                                     f"{m['id']} {m['type']} {m.get('game_clock')}  in {m['in_f']}  event {m['event_f']}  out {m['out_f']}",
                                     cols=4, tile_w=270)
        dur = len(cut.frame_map(m)) / fps
        L += [f"### {m['order']}. {m['id']} · {m['type']} · {m.get('game_clock')} · {dur:.1f} s"
              + (" · **key moment, 0.5× slow-down**" if m.get("slow") else ""), "",
              f"- **Caption ({m.get('caption_source') or 'none'}):** {m.get('caption') or '—'}",
              f"- Game's suggestion: {m.get('game_caption') or '—'}",
              f"- Facts: who **{m['who']}**; " + ", ".join(f"{k} {v}" for k, v in (m.get('facts') or {}).items()),
              f"- Cut: source frames {m['in_f']}–{m['out_f']} (event {m['event_f']}"
              + (f", kick {m['kick_f']}, scoring kick ≈ {m['kick_dist_m']} m in the replay" if m.get('kick_f') is not None and m.get('kick_dist_m') else "")
              + (f", hold {m['hold_f']} frames" if m.get('hold_f') else "") + ")",
              *( [f"- ⚠ {f}" for f in m["flags"]] ),
              f"- ![{m['id']}](review/{m['id']}.png)", ""]
    c = ep.get("closing") or {}
    L += ["## Closing card (" + (c.get("source") or "none") + ")", "",
          *[f"- {k}: {c.get(k) or '—'}" for k in ("head", "result", "could", "couldnt", "next")],
          *[f"- evidence · {e}" for e in c.get("evidence") or []], ""]
    dropped = [m for m in ep["moments"] if m["status"] != "keep"]
    L += ["## Not used", "", *[f"- {m['id']} {m['type']} {m.get('game_clock')} ({m['who']}): {m.get('drop_reason', '')}"
                               + (f". ⚠ {'; '.join(m['flags'])}" if m["flags"] else "") for m in sorted(dropped, key=lambda m: m.get('match_time_s') or 0)], ""]
    L += ["## Change things", "",
          "```bat",
          f"python -m studio.daily caption {paths.rel(path)} m03 \"your line\"",
          f"python -m studio.daily keep {paths.rel(path)} m11      &rem or: drop",
          f"python -m studio.daily closing {paths.rel(path)} --could \"...\" --couldnt \"...\" --next \"Day 2: ...\"",
          f"python -m studio.daily day {paths.rel(path)} 1",
          f"python -m studio.daily review {paths.rel(path)}",
          f"python -m studio.daily approve {paths.rel(path)} --by \"<you>\"",
          "```", ""]
    out = path.parent / "review.md"
    out.write_text("\n".join(L), encoding="utf-8")
    return out
