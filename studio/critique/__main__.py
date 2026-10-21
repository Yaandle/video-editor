"""python -m studio.critique <render.mp4> [--review review.json] [--samples 12] [--no-capture]"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np

from .. import beatgrid, config, jsbridge, paths, schema
from . import frames as F
from . import metrics as M
from . import rubric, sheets

SAFE_TEXT_MIN = 0.85     # share of settled text boxes that must sit in the safe area


def load_render(mp4: Path) -> tuple[dict, list[dict], dict]:
    rep_path = mp4.with_suffix(".report.json")
    fr_path = mp4.with_suffix(".frames.jsonl")
    if not rep_path.is_file() or not fr_path.is_file():
        raise SystemExit(f"{mp4.name}: report.json / frames.jsonl not found next to the video (render it with studio.render)")
    report = json.loads(rep_path.read_text(encoding="utf-8"))
    reports = [json.loads(ln) for ln in fr_path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    project = schema.load(Path(report["source"]))
    return report, reports, project


def pack_info(project: dict, reports: list[dict]) -> list[dict]:
    used = {project["settings"].get("style", "neo-brutal")}
    for r in reports:
        used.update(r.get("styles", []))
    info = {p["id"]: p for p in jsbridge.call("styles")}
    return [info[i] for i in sorted(used) if i in info]


def analyse(mp4: Path, review: dict | None, samples: int = 12, capture: bool = True, out_dir: Path | None = None) -> dict:
    report, reports, project = load_render(mp4)
    fps = report["fps"]
    if project["settings"]["fps"] != fps:      # the preset re-timed the project (e.g. 1080p60)
        project = schema.validate({**project, "settings": {**project["settings"], "fps": fps}})
    s = project["settings"]
    f0 = report["range"]["frames"][0]
    W, H, _, n_frames = F.probe_size(mp4)
    packs = pack_info(project, reports)
    main_pack = next((p for p in packs if p["id"] != "neo-brutal"), packs[0] if packs else {"id": "neo-brutal", "checks": []})
    checks = set(main_pack.get("checks") or [])
    events = jsbridge.events(project)

    gray = F.decode(mp4, 480, gray=True)
    rgb_small = F.decode(mp4, 480, gray=False)
    d = M.diffs(gray)
    animating = np.array([r.get("animating", False) for r in reports][: len(d)] + [False] * max(0, len(d) - len(reports)))

    # 1. Motion: frozen spans longer than 2 s count as dead air.
    frozen = M.spans(d < 0.08, int(2 * fps))
    frozen_frames = sum(b - a for a, b in frozen)
    m: dict = {"frames": int(len(d)), "fps": fps, "size": [W, H], "packs": [p["id"] for p in packs]}
    m["frozen_spans"] = [[(f0 + a) / fps, (f0 + b) / fps] for a, b in frozen]
    m["frozen_share"] = frozen_frames / max(1, len(d))
    m["motion_windows"] = len(events["motion"])
    m["detail"] = {"entropy_mean": round(float(np.mean([M.entropy(g) for g in gray[:: max(1, len(gray) // 30)]])), 2),
                   "edge_density_mean": round(float(np.mean([M.edge_density(g) for g in gray[:: max(1, len(gray) // 30)]])), 4)}

    # 2. Beat grid.
    bg = beatgrid.validate(project, events)
    m["off_grid"] = len(bg["violations"])
    m["beat_grid"] = {"checked": bg["checked"], "violations": bg["violations"][:8]}

    # 3–4. Boxes: hierarchy, layout.
    safe = s["width"] * 0.05, s["height"] * 0.05
    ok = tot = 0
    overflow = False
    contrast_frames = contrast_ok = 0
    centred = text_total = 0
    allcaps = set()
    for r in reports:
        texts = [b for b in r["boxes"] if b.get("kind") == "text" and b.get("settled", True)]
        for b in texts:
            text_total += 1
            if b.get("overflow"):
                overflow = True
            inside = b["x"] >= safe[0] - 1 and b["y"] >= safe[1] - 1 and b["x"] + b["w"] <= s["width"] - safe[0] + 1 and b["y"] + b["h"] <= s["height"] - safe[1] + 1
            ok += bool(inside or b.get("bleed") or b.get("gridBreak"))
            tot += 1
            cx = b["x"] + b["w"] / 2
            if b.get("w", 0) < s["width"] * 0.9 and abs(cx - s["width"] / 2) < s["width"] * 0.02 and b.get("lines", 1) >= 1 and b.get("role") in ("hero", "display", "h1", "h2"):
                centred += 1
        sizes = sorted({round(b.get("size", 0)) for b in texts if b.get("size")})
        if len(sizes) >= 2:
            contrast_frames += 1
            contrast_ok += bool(sizes[-1] / max(1, sizes[0]) >= 1.6)
        for w in r.get("warnings", []):
            if "all-caps" in w:
                allcaps.add(w)
    m["hierarchy"] = {"size_contrast_ok": (contrast_ok / contrast_frames) if contrast_frames else 1.0, "allcaps_headlines": len(allcaps)}
    m["layout"] = {"safe_ok": min(1.0, ((ok / tot) if tot else 1.0) / SAFE_TEXT_MIN), "overflow": overflow, "text_boxes": tot}

    # Sample frames for lossless checks: settled moments spread over the render.
    idx = np.linspace(0, len(reports) - 1, num=min(samples, len(reports))).round().astype(int)
    idx = sorted(set(int(i) for i in idx))
    pick = [f0 + i for i in idx]
    caps = {}
    if capture:
        caps = F.capture(project, pick, W, H, repeat=True)

    # 5. Legibility: rendered-pixel contrast of every text box in the sampled frames.
    leg_pass = leg_tot = 0
    small = []
    for i, f in zip(idx, pick):
        img = caps[f][0] if f in caps else F.frame_rgb(mp4, i, fps)
        k = W / s["width"]
        for b in reports[i]["boxes"]:
            if b.get("kind") != "text" or not b.get("settled", True) or b.get("w", 0) < 4:
                continue
            x0, y0 = int(max(0, b["x"] * k)), int(max(0, b["y"] * k))
            x1, y1 = int(min(W, (b["x"] + b["w"]) * k)), int(min(H, (b["y"] + b["h"]) * k))
            if x1 - x0 < 4 or y1 - y0 < 4:
                continue
            c = M.region_contrast(img[y0:y1, x0:x1])
            size = b.get("size", 0) * k
            need = 3.0 if size >= 48 else 4.5
            ok_ = c >= need and size >= 16
            leg_pass += bool(ok_)
            leg_tot += 1
            if not ok_:
                small.append({"frame": f, "text": str(b.get("text", ""))[:30], "contrast": round(c, 2), "size_px": round(size, 1)})
    m["legibility"] = {"score": (leg_pass / leg_tot) if leg_tot else 1.0, "checked": leg_tot, "failing": small[:8]}

    # Clips that opt out of the pack look (drawn on top, e.g. credits) are not part of the pack's picture.
    def keep_mask(i, img):
        m = np.ones(img.shape[:2], bool)
        kk = img.shape[1] / s["width"]
        if main_pack["id"] == "neo-brutal":
            return m
        for b in reports[i]["boxes"]:
            if b.get("style") == "neo-brutal":
                y0, x0 = int(max(0, b["y"] * kk)) - 2, int(max(0, b["x"] * kk)) - 2
                m[max(0, y0):int((b["y"] + b["h"]) * kk) + 3, max(0, x0):int((b["x"] + b["w"]) * kk) + 3] = False
        return m

    # 6. Cohesion: palette adherence of the picture to the pack palette — on the lossless
    #    full-resolution captures when available (video encoding and downscaling blend fine patterns).
    coh = main_pack.get("cohesion") or {}
    pal = list((main_pack.get("palette") or {}).values()) + list(coh.get("extra", []))
    pal = [p for p in pal if isinstance(p, str) and p.startswith("#")]
    if pal and caps:
        adherence = float(np.mean([M.palette_adherence(caps[f][0][keep_mask(i, caps[f][0])], pal, coh.get("de", 14)) for i, f in zip(idx, pick)]))
    elif pal:
        sample = rgb_small[:: max(1, len(rgb_small) // 24)]
        adherence = float(np.mean([M.palette_adherence(fr, pal, coh.get("de", 14)) for fr in sample]))
    else:
        adherence = 1.0
    m["cohesion"] = {"adherence": round(adherence, 4), "min": coh.get("min", 0.0), "palette": pal}

    # 7. Pack checks.
    pc: dict = {}
    if caps:
        same = [bool(np.array_equal(a, b)) for a, b in caps.values()]
        pc["determinism"] = {"score": float(np.mean(same)), "pass": all(same), "hard": True, "frames": len(same)}
    if "temporal" in checks:
        # Pattern crawl is measured on lossless captures of consecutive held frames (the
        # encoded video has small keyframe differences at every render-chunk boundary).
        still = [(a, b) for a, b in M.spans(~animating[: len(d)], 4) if b - a > 1]
        worst_video = max((float(d[a + 1:b].max()) for a, b in still), default=0.0)
        worst = 0.0
        if capture and still:
            runs = [list(range(f0 + a, f0 + min(b, a + 6))) for a, b in sorted(still, key=lambda x: x[0] - x[1])[:3]]
            held = F.capture(project, [f for r in runs for f in r], W, H)
            for r in runs:
                for x, y in zip(r, r[1:]):
                    worst = max(worst, float(np.abs(held[x].astype(np.int16) - held[y].astype(np.int16)).mean()))
        else:
            worst = worst_video
        pc["temporal"] = {"score": 1.0 if worst < 0.5 else max(0.0, 1 - (worst - 0.5) / 2), "pass": worst < 0.5, "hard": True,
                          "max_static_diff": round(worst, 4), "video_static_diff": round(worst_video, 4), "static_spans": len(still)}
    if "pixel" in checks and caps:
        nat = main_pack.get("native") or {"short": 180}
        k = max(1, int(min(W, H) // nat.get("short", 180)))
        masks = [keep_mask(i, caps[f][0]) for i, f in zip(idx, pick)]
        uni = [M.block_uniformity(caps[f][0], k, mk) for f, mk in zip(pick, masks)]
        exact = [M.exact_palette(caps[f][0], pal, mk) for f, mk in zip(pick, masks)] if pal else [1.0]
        sc = min(min(uni), min(exact))
        pc["pixel"] = {"score": sc, "pass": sc >= 0.999, "hard": True, "scale": k, "block_uniformity": round(min(uni), 5), "palette_exact": round(min(exact), 5)}
    if "topology" in checks:
        bgc = M.hex_rgb(main_pack.get("palette", {}).get(s.get("background"), "#F3EFE4") if not str(s.get("background", "")).startswith("#") else s["background"])
        area = np.array([M.silhouette_area(fr, bgc) for fr in rgb_small])
        pops = M.single_frame_pops(area)
        pc["topology"] = {"score": 1.0 if not pops else max(0.0, 1 - 0.2 * len(pops)), "pass": not pops, "hard": True,
                          "pops": [(f0 + p) / fps for p in pops][:8]}
    if "containment" in checks and caps:
        worst_out, worst_share = 0.0, 0.0
        for i, f in zip(idx, pick):
            a = caps[f][0]
            mask = M.iridescent_mask(a[::4, ::4])
            k = (W / s["width"]) / 4
            allowed = np.zeros_like(mask)
            for b in reports[i]["boxes"]:
                if b.get("style") == main_pack["id"]:
                    y0, x0 = int(max(0, b["y"] * k)), int(max(0, b["x"] * k))
                    allowed[y0:int((b["y"] + b["h"]) * k) + 1, x0:int((b["x"] + b["w"]) * k) + 1] = True
            outside = float((mask & ~allowed).mean())
            worst_out = max(worst_out, outside)
            worst_share = max(worst_share, float((mask & allowed).mean()))
        lim = (main_pack.get("slop") or {}).get("foil_max_share", 0.35)
        ok_c = worst_out <= 0.005 and worst_share <= lim
        pc["containment"] = {"score": 1.0 if ok_c else 0.4, "pass": ok_c, "hard": True, "foil_outside": round(worst_out, 5), "foil_share": round(worst_share, 4), "limit": lim}
    m["pack_checks"] = pc

    # 8. Audio from the render report.
    au = report.get("audio", {})
    fin = au.get("final", {})
    probs = []
    tgt = au.get("target_lufs", -14)
    if fin.get("integrated_lufs") is not None and abs(fin["integrated_lufs"] - tgt) > 1.5 and len(d) / fps > 5:
        probs.append(f"loudness {fin['integrated_lufs']} LUFS vs target {tgt}")
    if fin.get("true_peak_dbtp") is not None and fin["true_peak_dbtp"] > -0.95:
        probs.append(f"true peak {fin['true_peak_dbtp']} dBTP")
    if au.get("clipped_samples"):
        probs.append(f"{au['clipped_samples']} clipped samples")
    if report.get("av_drift_s", 0) > 1 / fps + 1e-3:
        probs.append(f"A/V drift {report['av_drift_s']} s")
    m["audio"] = {"lufs": fin.get("integrated_lufs"), "true_peak": fin.get("true_peak_dbtp"), "problems": probs}

    # 9. Slop: gradient filler and centred-by-default headlines.
    gsv = []
    ks = rgb_small.shape[2] / s["width"]
    for i in range(0, len(rgb_small), max(1, len(rgb_small) // 16)):
        ex = np.zeros(rgb_small.shape[1:3], bool)
        for b in (reports[i]["boxes"] if i < len(reports) else []):
            if b.get("kind") == "image":
                ex[int(max(0, b["y"] * ks)):int(max(0, (b["y"] + b["h"]) * ks)) + 1, int(max(0, b["x"] * ks)):int(max(0, (b["x"] + b["w"]) * ks)) + 1] = True
        gsv.append(M.smooth_gradient_share(rgb_small[i], ex))
    gs = float(np.mean(gsv))
    m["slop"] = {"gradient_share": round(gs, 4), "gradient_allow": (main_pack.get("slop") or {}).get("gradient_allow", 0.04),
                 "centred_share": round(centred / text_total, 3) if text_total else 0.0}

    # Stills + contact sheets.
    name = mp4.stem
    out_dir = out_dir or (paths.REPORTS / f"critique_{name}")
    stills = sheets.choose(events, reports, f0, fps, len(d), [x for a, b in frozen for x in (a, b - 1)])
    sheet_files = sheets.write(out_dir, rgb_small, stills, f0, fps, mp4)

    result = {"render": paths.rel(mp4), "when": datetime.now().isoformat(timespec="seconds"), "pack": main_pack["id"],
              "metrics": m, "stills": [paths.rel(p) for p in sheet_files], "review": review,
              "score": rubric.score(m, review)}
    return result


def main(argv=None) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="python -m studio.critique")
    ap.add_argument("render", help="rendered .mp4 (with its .report.json and .frames.jsonl)")
    ap.add_argument("--review", help="reviewer scores JSON: {anti_slop, style_fidelity, reviewer, notes}")
    ap.add_argument("--samples", type=int, default=12, help="frames re-captured losslessly for exact checks")
    ap.add_argument("--no-capture", action="store_true", help="skip lossless re-capture (no determinism/pixel checks)")
    a = ap.parse_args(argv)
    mp4 = Path(a.render).resolve()
    out_dir = paths.REPORTS / f"critique_{mp4.stem}"
    review_path = Path(a.review) if a.review else out_dir / "review.json"
    review = json.loads(review_path.read_text(encoding="utf-8")) if review_path.is_file() else None
    res = analyse(mp4, review, a.samples, not a.no_capture, out_dir)
    out = paths.REPORTS / f"critique_{mp4.stem}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, indent=2, default=lambda o: o.item() if hasattr(o, "item") else str(o)) + "\n", encoding="utf-8")
    sc = res["score"]
    print(f"critique {res['render']}  pack={res['pack']}")
    for k, v in sc["criteria"].items():
        print(f"  {k:<15} {'pending' if v is None else f'{v:.2f}'}")
    for k, v in res["metrics"]["pack_checks"].items():
        print(f"  check {k:<9} {'PASS' if v['pass'] else 'FAIL'}  {', '.join(f'{a}={b}' for a, b in v.items() if a not in ('score', 'pass', 'hard'))}")
    print(f"  total {sc['total']}/{sc['out_of']}{' (provisional: add a review.json for style fidelity)' if sc['provisional'] else ''} → {'PASS' if sc['pass'] else 'needs work'}")
    print(f"  contact sheets: {', '.join(res['stills'][:3])}{' …' if len(res['stills']) > 3 else ''}")
    print(f"  report: {paths.rel(out)}")
    return 0 if sc["pass"] or sc["provisional"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
