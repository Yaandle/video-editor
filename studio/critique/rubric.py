"""The 10-point rubric. One point per criterion, each scored 0–1.

  1 motion        springs land and settle; no dead air (frozen > 2 s while the scene should live)
  2 beat          cuts and hits within one frame of the grid
  3 hierarchy     scale contrast between text roles; no all-caps headlines by default
  4 layout        text inside the safe area unless it is a deliberate bleed/grid break; no overflow
  5 legibility    text contrast and size, measured on the rendered pixels
  6 colour        palette adherence to the pack's tokens.json (cohesion)
  7 finish        pack integrity: temporal stability, pixel integrity, topology, containment, determinism
  8 audio         loudness on target, true peak ≤ −1 dBTP, no clipping, A/V drift ≤ 1 frame
  9 anti-slop     no gradient filler, no centred-by-default, no glow (auto) — capped by the reviewer
 10 fidelity      reads instantly as this style, not a generic filter (reviewer)

Criteria 1–8 are measured. 9 is measured and capped by a reviewer score; 10 is
reviewer-only. Without a review file the total is marked provisional.
"""
from __future__ import annotations

PASS_SCORE = 8.0
NAMES = ["motion", "beat", "hierarchy", "layout", "legibility", "colour", "finish", "audio", "anti_slop", "style_fidelity"]


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


def score(m: dict, review: dict | None) -> dict:
    s: dict[str, float | None] = {}
    s["motion"] = clamp01(1 - 4 * m["frozen_share"]) * (1.0 if m["motion_windows"] else 0.6)
    s["beat"] = clamp01(1 - 0.25 * m["off_grid"])
    hc = m["hierarchy"]
    s["hierarchy"] = clamp01(0.6 * hc["size_contrast_ok"] + 0.4 * (0.5 ** hc["allcaps_headlines"]))
    s["layout"] = clamp01(m["layout"]["safe_ok"] * (0.6 if m["layout"]["overflow"] else 1.0))
    s["legibility"] = clamp01(m["legibility"]["score"])
    coh = m["cohesion"]
    s["colour"] = clamp01(coh["adherence"] / coh["min"]) if coh["min"] else 1.0
    fin = [v["score"] for v in m["pack_checks"].values()]
    s["finish"] = clamp01(sum(fin) / len(fin)) if fin else 1.0
    a = m["audio"]
    s["audio"] = clamp01(1 - 0.25 * len(a["problems"]))
    auto_slop = clamp01(1 - max(0.0, m["slop"]["gradient_share"] - m["slop"]["gradient_allow"]) * 8 - (0.3 if m["slop"]["centred_share"] > 0.5 else 0))
    if review:
        s["anti_slop"] = min(auto_slop, clamp01(review.get("anti_slop", 1.0)))
        s["style_fidelity"] = clamp01(review.get("style_fidelity", 0.0))
    else:
        s["anti_slop"] = auto_slop
        s["style_fidelity"] = None
    total = sum(v for v in s.values() if v is not None)
    provisional = review is None
    return {
        "criteria": {k: (round(v, 3) if v is not None else None) for k, v in s.items()},
        "total": round(total, 2),
        "out_of": 10 if not provisional else 9,
        "provisional": provisional,
        "pass": (not provisional) and total >= PASS_SCORE and all(c["pass"] for c in m["pack_checks"].values() if c.get("hard")),
    }
