"""T3: caption drafts in the series voice, from the export's facts only.

"I" is the player the export marks human; "we" is my side when the AI is playing them;
"the AI" is the other side. Distances come from the replay's own measurement of the scoring
kick when the export's figure disagrees with it (episode.py flags that). Nothing is invented:
a line only says what a field in moments.json or the replay says. Every line is a draft
(`caption_source: "draft"`) until you approve the episode. Lines you write yourself are
kept (`caption_source: "you"`) and never overwritten.

The closing card is drafted from the final score and the kept moments, and flagged as a
draft: what the AI could and couldn't do is your call.
"""
from __future__ import annotations

import re

MAX_WORDS = 8
CHAIN_FREE = 2           # the game's own HighlightTable.CHAIN_FREE


def words(text: str) -> int:
    """Words in a line, with a number and its unit ("67 m") counted once."""
    return len([w for w in str(text).split() if w != "m"])


def _dist(m: dict) -> int | None:
    d = m.get("kick_dist_m") if any(f.startswith("distance mismatch") for f in m.get("flags") or []) else None
    if d is None:
        d = (m.get("facts") or {}).get("distance")
    return int(round(float(d))) if d is not None else None


def _goals(score: str | None) -> int | None:
    mt = re.match(r"\s*(\d+)\.(\d+)", str(score or ""))
    return int(mt.group(1)) if mt else None


def line(m: dict, ep: dict) -> str | None:
    t, who, fx = m.get("type"), m.get("who"), m.get("facts") or {}
    if who == "unknown" or not t:
        return None
    subj = {"me": "I", "teammate": "We", "ai": "The AI"}[who]
    d = _dist(m)
    at = f" from {d} m" if d is not None else ""
    if t == "goal":
        chain = int(fx.get("chain") or 0)
        sb, sa = m.get("score_before") or {}, m.get("score_after") or {}
        ai, me = ep["sides"].get("ai"), ep["sides"].get("me")
        if fx.get("after_siren"):
            return f"{subj} {'kick' if who != 'ai' else 'kicks'} it after the siren"
        if who == "ai" and ai and _goals(sb.get(ai)) == 0:
            return f"The AI's first goal{',' if at else ''}{at}"
        if fx.get("go_ahead") and ai and me:
            mine, theirs = sa.get(f"{me}_points"), sa.get(f"{ai}_points")
            if mine is not None and theirs is not None:
                if mine == theirs:
                    return f"{subj} {'levels' if who == 'ai' else 'level'} it{at}"
                ahead = (theirs > mine) if who == "ai" else (mine > theirs)
                if ahead:
                    return f"{subj} {'hits' if who == 'ai' else 'hit'} the front{at}"
        if chain > CHAIN_FREE:
            verb = "finishes" if who == "ai" else "finish"
            return f"{subj} {verb} a {chain}-kick chain"
        verb = "kicks" if who == "ai" else "kick"
        if d is None:
            return f"{subj} {verb} a goal"
        run = " on the run" if fx.get("on_the_run") and d >= 40 else ""
        return f"{subj} {verb} a {d} m goal{run}"
    if t == "behind":
        return f"{subj} just {'misses' if who == 'ai' else 'miss'}{at}"
    if t == "mark":
        contested, high = fx.get("contested"), fx.get("high")
        if who == "ai" and m.get("opponent_is_me") and contested:
            return "The AI flies over me to mark it"
        if who in ("me", "teammate") and contested:
            return f"{subj} {'fly' if who == 'me' else 'fly'} over the AI to mark it"
        if contested:
            return "The AI takes a big contested mark"
        if high:
            return f"{subj} {'takes' if who == 'ai' else 'take'} a towering mark"
        return f"{subj} {'marks' if who == 'ai' else 'mark'} it cleanly"
    if t == "tackle":
        return f"{subj} {'lays' if who == 'ai' else 'lay'} a big tackle"
    if t == "bump":
        return f"{subj} {'lays' if who == 'ai' else 'lay'} a bump"
    if t == "long_kick":
        return f"{subj} {'launches' if who == 'ai' else 'launch'} one{at}"
    if t == "ruck":
        return f"{subj} {'wins' if who == 'ai' else 'win'} the hit-out"
    return None


def draft(ep: dict) -> list[str]:
    """Fill drafts for kept moments that have no line of yours. Returns problems."""
    problems = []
    for m in ep["moments"]:
        if m.get("caption_source") == "you":
            continue
        txt = line(m, ep)
        m["caption"], m["caption_source"] = (txt, "draft") if txt else (None, None)
        if m["status"] == "keep":
            if not txt:
                problems.append(f"{m['id']}: no caption could be drafted (type or player unknown): write one")
            elif words(txt) > MAX_WORDS:
                problems.append(f"{m['id']}: draft is {words(txt)} words: shorten it")
    ep["closing"] = closing(ep) if (ep.get("closing") or {}).get("source") != "you" else ep["closing"]
    return problems


def closing(ep: dict) -> dict:
    fin = (ep["source"].get("match") or {}).get("final") or {}
    me, ai = ep["sides"].get("me"), ep["sides"].get("ai")
    out = {"head": None, "result": None, "could": None, "couldnt": None, "next": None, "source": "draft", "evidence": []}
    if not (me and ai and fin):
        return out
    mp, ap = fin.get(f"{me}_points"), fin.get(f"{ai}_points")
    out["result"] = f"Me {fin.get(me)} · AI {fin.get(ai)}"
    if mp is not None and ap is not None:
        out["head"] = "Full time · " + ("not yet" if mp > ap else "it beat me" if ap > mp else "a draw, not yet")
    kept = [m for m in ep["moments"] if m["status"] == "keep"]
    allm = ep["moments"]
    ai_marks_over_me = [m for m in allm if m.get("who") == "ai" and m.get("type") == "mark" and m.get("opponent_is_me")]
    ai_goals = _goals(fin.get(ai))
    if ai_marks_over_me:
        out["could"] = "AI could: out-mark me in the air"
        out["evidence"].append(f"could: {len(ai_marks_over_me)} AI marks over my player ({', '.join(m['id'] + ' ' + (m.get('game_clock') or '') for m in ai_marks_over_me)})")
    elif ai_goals:
        out["could"] = f"AI could: kick {ai_goals} goals"
        out["evidence"].append(f"could: final score {fin.get(ai)}")
    long_mine = [m for m in allm if m.get("who") == "me" and m.get("type") == "goal" and (_dist(m) or 0) >= 50]
    if long_mine and mp is not None and ap is not None and mp > ap:
        out["couldnt"] = "AI couldn't: stop my long goals"
        out["evidence"].append("couldn't: my goals from " + ", ".join(f"{_dist(m)} m ({m['id']})" for m in long_mine))
    elif mp is not None and ap is not None and mp > ap:
        out["couldnt"] = f"AI couldn't: close a {mp - ap}-point gap"
        out["evidence"].append(f"couldn't: final margin {mp - ap}")
    if not kept:
        out["evidence"].append("no moments kept yet")
    return out
