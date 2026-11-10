"""python -m studio.daily <command> — see docs/AFL_DAILY.md."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .. import paths
from . import episode as E


def _ep_path(arg: str) -> Path:
    p = Path(arg)
    if p.is_dir():
        p = p / "episode.json"
    if not p.is_file():
        cand = E.ROOT / arg / "episode.json"
        if cand.is_file():
            return cand
        raise FileNotFoundError(f"no episode at {arg}")
    return p


def cmd_ingest(a) -> int:
    src = Path(a.source)
    if a.raw or src.is_file():
        p = E.ingest_raw(src, slug=a.slug, day=a.day)
    else:
        p = E.ingest_export(src, slug=a.slug, day=a.day, workers=a.workers)
    print(f"wrote {paths.rel(p)}\n")
    print(E.table(E.load(p)))
    return 0


def cmd_list(a) -> int:
    print(E.table(E.load(_ep_path(a.episode))))
    return 0


def cmd_day(a) -> int:
    p = _ep_path(a.episode)
    ep = E.load(p)
    ep["day"] = int(a.n)
    E.save(p, ep)
    print(f"{ep['slug']}: day {ep['day']}")
    return 0


def cmd_cut(a) -> int:
    from . import captions, cut
    p = _ep_path(a.episode)
    ep = E.load(p)
    s = cut.auto(ep)
    probs = captions.draft(ep)
    E.save(p, ep)
    print(f"kept {sum(m['status'] == 'keep' for m in ep['moments'])} moments, ~{s['total_s']} s with cards; key moment {s['key']}")
    for x in probs:
        print(f"[!] {x}")
    print()
    print(E.table(ep))
    return 0


def cmd_captions(a) -> int:
    from . import captions
    p = _ep_path(a.episode)
    ep = E.load(p)
    for x in captions.draft(ep):
        print(f"[!] {x}")
    E.save(p, ep)
    print(E.table(ep))
    return 0


def _moment(ep: dict, mid: str) -> dict:
    m = next((m for m in ep["moments"] if m["id"] == mid), None)
    if m is None:
        raise SystemExit(f"no moment {mid}")
    return m


def cmd_caption(a) -> int:
    p = _ep_path(a.episode)
    ep = E.load(p)
    m = _moment(ep, a.moment)
    m["caption"], m["caption_source"] = a.text.strip(), "you"
    E.save(p, ep)
    print(f"{m['id']}: {m['caption']}")
    return 0


def cmd_keep(a, status: str) -> int:
    from . import cut
    p = _ep_path(a.episode)
    ep = E.load(p)
    m = _moment(ep, a.moment)
    clips = {c["id"]: c for c in ep["clips"]}
    if status == "keep":
        if m.get("in_f") is None:
            m["in_f"], m["out_f"], m["hold_f"] = cut.trim(m, clips[m["clip"]])
        m["status"] = "keep"
        m.pop("drop_reason", None)
    else:
        m["status"], m["drop_reason"] = "drop", "dropped by you"
    kept = sorted([x for x in ep["moments"] if x["status"] == "keep"], key=lambda x: x.get("match_time_s") or 0)
    for i, x in enumerate(kept, 1):
        x["order"] = i
    E.save(p, ep)
    print(E.table(ep))
    return 0


def cmd_closing(a) -> int:
    p = _ep_path(a.episode)
    ep = E.load(p)
    c = ep.setdefault("closing", {})
    for k in ("head", "result", "could", "couldnt", "next"):
        v = getattr(a, k)
        if v is not None:
            c[k] = v or None
            c["source"] = "you"
    E.save(p, ep)
    print({k: c.get(k) for k in ("head", "result", "could", "couldnt", "next", "source")})
    return 0


RISK = {"own": "low", "royalty-free": "low", "synth": "low", "commercial": "high", "cover": "high", "unknown": "unknown"}


def cmd_music(a) -> int:
    p = _ep_path(a.episode)
    ep = E.load(p)
    f = Path(a.file)
    if not f.is_absolute():
        f = paths.ROOT / f
    if not f.is_file():
        raise SystemExit(f"no such file: {a.file}")
    risk = RISK[a.licence]
    ep["music"] = {"file": paths.rel(f), "title": a.title, "artist": a.artist, "source": a.source, "licence": a.licence,
                   "licence_url": a.licence_url, "confirmed": bool(a.confirmed_by) and risk == "low",
                   "confirmed_by": a.confirmed_by, "mute_risk": risk, "start_s": a.start, "gain_db": a.gain}
    E.save(p, ep)
    print(ep["music"])
    if not ep["music"]["confirmed"]:
        print("[!] not used in renders: needs --licence own/royalty-free/synth and --confirmed-by")
    return 0


def cmd_review(a) -> int:
    from . import review
    p = _ep_path(a.episode)
    out = review.write(p)
    print(f"wrote {paths.rel(out)}")
    for b in review.blockers(E.load(p)):
        print(f"[!] {b}")
    return 0


def cmd_approve(a) -> int:
    from . import review
    rv = review.approve(_ep_path(a.episode), a.by, a.notes or "")
    print(f"approved by {rv['by']} at {rv['at']}")
    return 0


def cmd_build(a) -> int:
    from . import build
    out = build.build(_ep_path(a.episode), final=a.final)
    print(f"wrote {paths.rel(out)}")
    print(f"render: render.bat {paths.rel(out)} --preset vertical")
    return 0


def cmd_verify(a) -> int:
    import json
    from . import verify
    r = verify.verify(Path(a.render))
    for c in r["checks"]:
        print(f"{'ok  ' if c['ok'] else 'FAIL'}  {c['name']:<15} {c['detail']}")
    print("PASS" if r["ok"] else "FAIL")
    Path(a.render).with_suffix(".verify.json").write_text(json.dumps(r, indent=1, ensure_ascii=False), encoding="utf-8")
    return 0 if r["ok"] else 1


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="python -m studio.daily", description="Daily AFL series pipeline")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("ingest", help="T1: an AR2 highlights folder (or a raw clip with --raw) → episode.json")
    s.add_argument("source")
    s.add_argument("--slug", help="folder name under media/afl-daily/ (default: from the source name)")
    s.add_argument("--day", type=int, help="the series day number")
    s.add_argument("--raw", action="store_true", help="a raw recording with no moments.json")
    s.add_argument("--workers", type=int, default=4)
    s.set_defaults(fn=cmd_ingest)

    s = sub.add_parser("list", help="T1: print the moments and their flags")
    s.add_argument("episode")
    s.set_defaults(fn=cmd_list)

    s = sub.add_parser("day", help="set the day number")
    s.add_argument("episode")
    s.add_argument("n", type=int)
    s.set_defaults(fn=cmd_day)

    s = sub.add_parser("cut", help="T2: pick, trim and order the moments, choose the key moment; drafts captions (T3)")
    s.add_argument("episode")
    s.set_defaults(fn=cmd_cut)

    s = sub.add_parser("captions", help="T3: redraft captions (your own lines are kept)")
    s.add_argument("episode")
    s.set_defaults(fn=cmd_captions)

    s = sub.add_parser("caption", help="T3: write a moment's caption yourself")
    s.add_argument("episode")
    s.add_argument("moment")
    s.add_argument("text")
    s.set_defaults(fn=cmd_caption)

    for name in ("keep", "drop"):
        s = sub.add_parser(name, help=f"{name} a moment")
        s.add_argument("episode")
        s.add_argument("moment")
        s.set_defaults(fn=lambda a, _n=name: cmd_keep(a, _n))

    s = sub.add_parser("closing", help="T3: set the closing card lines (your words)")
    s.add_argument("episode")
    for k in ("head", "result", "could", "couldnt", "next"):
        s.add_argument(f"--{k}")
    s.set_defaults(fn=cmd_closing)

    s = sub.add_parser("music", help="T4: log the music bed and its licence (renders use it only when confirmed)")
    s.add_argument("episode")
    s.add_argument("file")
    s.add_argument("--title", required=True)
    s.add_argument("--artist", required=True)
    s.add_argument("--source", required=True, help="where it came from")
    s.add_argument("--licence", required=True, choices=sorted(RISK))
    s.add_argument("--licence-url")
    s.add_argument("--confirmed-by")
    s.add_argument("--start", type=float, default=0.0, help="seconds into the track")
    s.add_argument("--gain", type=float, default=-6.0)
    s.set_defaults(fn=cmd_music)

    s = sub.add_parser("review", help="T6: write review.md and contact sheets")
    s.add_argument("episode")
    s.set_defaults(fn=cmd_review)

    s = sub.add_parser("approve", help="T6: your approval (hash of the whole episode)")
    s.add_argument("episode")
    s.add_argument("--by", required=True)
    s.add_argument("--notes")
    s.set_defaults(fn=cmd_approve)

    s = sub.add_parser("build", help="episode → projects/afl-daily-dayNNN.json (DRAFT unless approved)")
    s.add_argument("episode")
    s.add_argument("--final", action="store_true", help="refuse unless approved and unchanged")
    s.set_defaults(fn=cmd_build)

    s = sub.add_parser("verify", help="T5: check a rendered mp4")
    s.add_argument("render")
    s.set_defaults(fn=cmd_verify)

    a = ap.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    raise SystemExit(main())
