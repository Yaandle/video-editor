"""T2: automatic cutting. Trim each moment to the action, pick the best ones for a 20–45 s
episode, put them in game-time order, and choose one key moment for a slow-down.

Trims come from the replay's ball track (episode.py), so they're frame-exact:
  goal / behind  from just before the scoring kick to just after the ball crosses, ending
                 before the ball gets 5 m past the line (the replay camera follows it into
                 the trees after that), then a short hold on the last frame for the GOAL stamp
  mark           from the kick that delivers it (if it's within 2.8 s) to 0.8 s after the catch
A cut never starts before a ball reset inside the clip: the camera snaps there.

Picking leans toward the series question, "can the AI beat me yet": the AI's moments get a
bonus, and both sides must be in the episode when the match has them. A moment whose replay
disagrees with the export (a distance mismatch) is not picked automatically; you can still
keep it at review.
"""
from __future__ import annotations

FPS = 30
TYPE_RULES = {
    # lead before the kick, tail after the event, hold on the last frame (seconds)
    "goal": {"run_up": 0.6, "tail": 0.5, "hold": 0.5, "fallback_lead": 3.0},
    "behind": {"run_up": 0.6, "tail": 0.5, "hold": 0.3, "fallback_lead": 3.0},
    "mark": {"run_up": 0.2, "tail": 0.8, "hold": 0.0, "fallback_lead": 2.0, "max_flight": 2.8},
}
DEFAULT_RULE = {"run_up": 0.5, "tail": 1.0, "hold": 0.0, "fallback_lead": 2.5}
SLOW_RATE = 0.5
SLOW_LEAD_S = 0.3        # the slow-down starts this long before the ball crosses

AI_BONUS = 25.0
AI_FIRST_GOAL_BONUS = 15.0
BUDGET_S = (20.0, 45.0)
CARDS_S = 2.6 + 6.0      # day card + closing card (build.py sets the real lengths)
MAX_MOMENTS = 7
REPEAT_PENALTY = 40.0    # per moment already picked of the same type by the same side


def trim(m: dict, clip: dict) -> tuple[int, int, int]:
    """(in_f, out_f, hold_f) for a moment, in source frames (out_f inclusive)."""
    fps = float(clip.get("fps") or FPS)
    frames = int(clip.get("frames") or 0)
    rule = TYPE_RULES.get(m.get("type") or "", DEFAULT_RULE)
    ev = int(m["event_f"])
    floor = max([0] + [j + 3 for j in m.get("jumps") or [] if j <= ev])
    k = m.get("kick_f")
    if k is not None and (rule.get("max_flight") is None or ev - k <= rule["max_flight"] * fps):
        in_f = k - round(rule["run_up"] * fps)
    else:
        in_f = ev - round(rule["fallback_lead"] * fps)
    in_f = max(floor, in_f)
    out_f = ev + round(rule["tail"] * fps)
    for stop in (m.get("leaves_f"), m.get("reset_f")):
        if stop is not None:
            out_f = min(out_f, int(stop) - 1)
    out_f = min(out_f, frames - 1) if frames else out_f
    out_f = max(out_f, ev)
    return in_f, out_f, round(rule["hold"] * fps)


def seconds(m: dict, clip: dict, slow: dict | None = None) -> float:
    in_f, out_f, hold = trim(m, clip)
    n = out_f - in_f + 1 + hold
    if slow:
        n += round((slow["to_f"] - slow["from_f"]) * (1 / slow["rate"] - 1))
    return n / float(clip.get("fps") or FPS)


def series_score(m: dict, ep: dict) -> float:
    s = float(m.get("highlight_score") or 0)
    if m.get("who") == "ai":
        s += AI_BONUS
        sb = m.get("score_before") or {}
        ai = ep["sides"].get("ai")
        if m.get("type") == "goal" and ai and str(sb.get(ai, "")).startswith("0."):
            s += AI_FIRST_GOAL_BONUS
    return s


def _dupe_key(m: dict) -> tuple:
    """Two contests between the same two players (the AI's #5 out-marking my #16 twice) read
    as a repeat; two goals by the same kicker don't."""
    ps = m.get("players") or []
    if len(ps) < 2:
        return (m["id"],)
    return (m.get("type"), tuple(sorted(p.get("name", "") for p in ps)))


def auto(ep: dict, budget_s: float | None = None) -> dict:
    """Pick, trim, order and choose the key moment. Rewrites status/order/in_f/out_f/slow
    on every moment and returns a summary."""
    clips = {c["id"]: c for c in ep["clips"]}
    budget = (budget_s or BUDGET_S[1] - 3) - CARDS_S
    usable, skipped = [], {}
    for m in ep["moments"]:
        m.update(status="drop", order=None, in_f=None, out_f=None, hold_f=0, slow=None)
        c = clips[m["clip"]]
        if m.get("event_f") is None or not c.get("proxy"):
            skipped[m["id"]] = "no event frame or no clip"
            continue
        if any(f.startswith("distance mismatch") for f in m["flags"]):
            skipped[m["id"]] = "replay disagrees with the export"
            continue
        m["in_f"], m["out_f"], m["hold_f"] = trim(m, c)
        usable.append(m)

    seen, picked, total = set(), [], 0.0
    kinds: dict[tuple, int] = {}

    def take(m):
        nonlocal total
        picked.append(m)
        seen.add(_dupe_key(m))
        kinds[(m.get("type"), m.get("who"))] = kinds.get((m.get("type"), m.get("who")), 0) + 1
        total += seconds(m, clips[m["clip"]])

    # the best of each side first, so both are in the episode when the match has them
    for side in ("me", "ai"):
        best = max((m for m in usable if m.get("who") == side), key=lambda m: series_score(m, ep), default=None)
        if best:
            take(best)
    # then greedy, with each repeat of the same type by the same side worth less, so the
    # episode isn't five marks in a row
    while len(picked) < MAX_MOMENTS:
        pool = [m for m in usable if m not in picked and _dupe_key(m) not in seen]
        for m in usable:
            if m not in picked and _dupe_key(m) in seen:
                skipped.setdefault(m["id"], "same players and type as a better moment")
        pool = [m for m in pool if total + seconds(m, clips[m["clip"]]) <= budget]
        if not pool:
            break
        take(max(pool, key=lambda m: series_score(m, ep) - REPEAT_PENALTY * kinds.get((m.get("type"), m.get("who")), 0)))
    for m in usable:
        if m not in picked:
            skipped.setdefault(m["id"], "lower in the ranking, or over the length budget")

    # key moment: my best goal, else the best goal, else the best moment; slow on the crossing
    goals = [m for m in picked if m.get("type") == "goal"]
    key = next((m for m in sorted(goals, key=lambda m: -(m.get("kick_dist_m") or 0)) if m.get("who") == "me"), None) \
        or (max(goals, key=lambda m: m.get("kick_dist_m") or 0) if goals else None)
    if key:
        fps = float(clips[key["clip"]].get("fps") or FPS)
        frm = max(key["in_f"], key["event_f"] - round(SLOW_LEAD_S * fps))
        key["slow"] = {"from_f": frm, "to_f": key["out_f"] + 1, "rate": SLOW_RATE}
        total += seconds(key, clips[key["clip"]], key["slow"]) - seconds(key, clips[key["clip"]])

    for i, m in enumerate(sorted(picked, key=lambda m: m.get("match_time_s") or 0), 1):
        m["status"], m["order"] = "keep", i
    for m in ep["moments"]:
        if m["status"] != "keep":
            m["drop_reason"] = skipped.get(m["id"], "not picked")
        else:
            m.pop("drop_reason", None)
    ep["cut"] = {"moments_s": round(total, 2), "cards_s": CARDS_S, "total_s": round(total + CARDS_S, 2),
                 "key": key["id"] if key else None, "budget_s": list(BUDGET_S)}
    return ep["cut"]


def frame_map(m: dict) -> list[int]:
    """Source frame for every output frame of a kept moment (output at the source rate)."""
    out = []
    slow = m.get("slow")
    f = m["in_f"]
    while f <= m["out_f"]:
        if slow and slow["from_f"] <= f < slow["to_f"]:
            reps = round(1 / slow["rate"])
            out += [f] * reps
        else:
            out.append(f)
        f += 1
    out += [m["out_f"]] * int(m.get("hold_f") or 0)
    return out
