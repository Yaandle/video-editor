"""The moments file: source log, candidates, analysis, annotations, review gate.

One JSON file per breakdown (media/afl-breakdown/<slug>/moments.json) plus a
readable summary written next to it (moments.md). Frame numbers are frames of
the clip's proxy; positions are proxy pixels. Schema: `vidkit.footy-moments` v1.

Honesty rules, enforced by `check` (errors stop the build):
  - every claim has a confidence: seen (plainly visible in the frames), likely
    (a reasonable reading of what is visible), unsure (cannot be confirmed);
  - on-screen captions may only rest on seen or likely claims, never unsure;
  - every kept moment says what could not be told from the footage;
  - a moment with no clear teaching point is dropped, with the reason;
  - names, jumper numbers and scores are flagged for checking wherever they appear.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

SCHEMA = "vidkit.footy-moments"
Confidence = Literal["seen", "likely", "unsure"]
Category = Literal["positioning", "spacing", "contest", "decision", "technique"]
Colour = Literal["lime", "orange", "cobalt", "paper", "ink"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class TimeRange(Strict):
    in_: str = Field(..., alias="in", description="start in the original file or stream, HH:MM:SS.mmm")
    out: str


class Source(Strict):
    kind: Literal["file", "link", "placeholder"]
    url: Optional[str] = None
    file: Optional[str] = None
    competition: str
    match: Optional[str] = None
    date: Optional[str] = Field(None, description="match date, YYYY-MM-DD")
    broadcaster: Optional[str] = None
    time_range: TimeRange
    rights: Literal["unchecked", "cleared", "own", "placeholder"] = "unchecked"
    notes: str = ""


class Clip(Strict):
    id: str = Field(..., pattern=r"^[A-Za-z0-9_\-]{1,32}$")
    proxy: str
    fps: float = Field(..., gt=0)
    frames: int = Field(..., gt=0)
    width: int
    height: int
    audio: bool = False
    audio_file: Optional[str] = Field(None, description="the clip's audio, cut from the same range (the proxy is video only)")
    placeholder: bool = False
    source: Source


class Signal(Strict):
    signal: str
    frame: int
    z: Optional[float] = None
    reads_as: str = ""


class Candidate(Strict):
    id: str
    clip: str
    rank: int
    peak_f: int
    start_f: int
    end_f: int
    score: float
    shot: list[int] = Field(default_factory=list)
    replay_suspect: bool = False
    signals: list[Signal] = Field(default_factory=list)
    sheet: Optional[str] = None
    # vision pass
    visible: str = ""
    why: str = ""
    vision_rank: Optional[int] = None
    status: Literal["proposed", "chosen", "dropped"] = "proposed"
    drop_reason: str = ""


class Claim(Strict):
    id: str
    text: str
    confidence: Confidence
    frames: list[int] = Field(default_factory=list, description="frames that show it")


class Caption(Strict):
    text: str
    claims: list[str] = Field(default_factory=list)


class Captions(Strict):
    watch: Optional[Caption] = None
    freeze: list[Caption] = Field(default_factory=list)
    outcome: Optional[Caption] = None


class Key(Strict):
    f: int
    x: float
    y: float
    w: Optional[float] = None
    h: Optional[float] = None
    conf: Optional[float] = Field(None, ge=0, le=1)


class Track(Strict):
    label: str
    keys: list[Key]
    interp: Literal["smooth", "ease", "linear", "hold"] = "smooth"
    source: Literal["vision", "manual", "cv"] = "vision"
    point: Literal["feet", "body", "ball", "focus"] = "feet"
    adjust: bool = False
    note: str = ""


class PointRef(Strict):
    x: Optional[float] = None
    y: Optional[float] = None
    track: Optional[str] = None
    dx: float = 0
    dy: float = 0

    @model_validator(mode="after")
    def one_kind(self):
        if self.track is None and (self.x is None or self.y is None):
            raise ValueError("a point is either {x, y} or {track}")
        return self


class Annotation(Strict):
    id: str
    kind: Literal["ring", "spotlight", "arrow", "line", "zone", "label"]
    track: Optional[str] = None
    at: Optional[PointRef] = None
    from_: Optional[PointRef] = Field(None, alias="from")
    to: Optional[PointRef] = None
    via: Optional[PointRef] = None
    points: list[PointRef] = Field(default_factory=list)
    r: Optional[float] = Field(None, gt=0)
    squash: Optional[float] = Field(None, gt=0)
    color: Optional[Colour] = None
    width: Optional[float] = None
    dash: bool = False
    spot: Optional[bool] = Field(None, description="rings see through the freeze dim unless false")
    label: Optional[str] = Field(None, max_length=24)
    text: Optional[str] = Field(None, max_length=24)
    label_color: Optional[Colour] = None
    dx: Optional[float] = None
    dy: Optional[float] = None
    when: Literal["freeze", "follow", "play", "all"] = "freeze"
    claims: list[str] = Field(default_factory=list)
    adjust: bool = False
    note: str = ""

    @model_validator(mode="after")
    def shape(self):
        need = {"ring": ("track|at",), "spotlight": ("track|at",), "arrow": ("from", "to"), "line": ("from", "to"),
                "label": ("at",), "zone": ("points",)}[self.kind]
        for n in need:
            if n == "track|at" and not (self.track or self.at):
                raise ValueError(f"{self.kind} needs track or at")
            if n == "from" and not self.from_:
                raise ValueError(f"{self.kind} needs from")
            if n == "to" and not self.to:
                raise ValueError(f"{self.kind} needs to")
            if n == "at" and self.kind == "label" and not self.at:
                raise ValueError("label needs at")
            if n == "points" and len(self.points) < 3:
                raise ValueError("zone needs 3+ points")
        return self


class Camera(Strict):
    focus: Optional[str] = Field(None, description="track the play framing follows")
    at: Optional[PointRef] = None
    zoom: float = Field(1, gt=0.2, le=4)
    max_zoom: float = Field(1.35, ge=1, le=4)
    min_zoom: float = Field(1, gt=0.1, le=4)
    margin: float = Field(0.2, ge=0, le=1)
    freeze: Literal["fit", "hold"] = "fit"


class Playback(Strict):
    lead_in_rate: Optional[float] = Field(None, gt=0, le=4)
    resume_rate: Optional[float] = Field(None, gt=0, le=4)
    hold_s: Optional[float] = Field(None, gt=0, le=30)
    end_min_s: Optional[float] = Field(None, gt=0, le=10)


class Moment(Strict):
    id: str = Field(..., pattern=r"^[A-Za-z0-9_\-]{1,32}$")
    clip: str
    candidate: Optional[str] = None
    status: Literal["keep", "drop"] = "keep"
    drop_reason: str = ""
    title: str = Field("", max_length=60)
    category: Optional[Category] = None
    teaching_point: str = ""
    in_f: int = Field(..., ge=0)
    freeze_f: int = Field(..., ge=0)
    out_f: int = Field(..., ge=0)
    slow_until_f: Optional[int] = None
    claims: list[Claim] = Field(default_factory=list)
    cannot_tell: list[str] = Field(default_factory=list)
    captions: Captions = Field(default_factory=Captions)
    tracks: dict[str, Track] = Field(default_factory=dict)
    annotations: list[Annotation] = Field(default_factory=list)
    camera: Camera = Field(default_factory=Camera)
    playback: Playback = Field(default_factory=Playback)
    voice: Optional[str] = Field(None, description="optional voice line (media/... wav or mp3), placed in the hold")


class AudioOpts(Strict):
    footage: bool = True
    footage_gain_db: float = -12
    music: Optional[str] = "sketch.lofi"
    music_gain_db: float = -20
    freeze_tick: bool = True


class Vision(Strict):
    model: str = ""
    notes: str = ""


class Review(Strict):
    status: Literal["draft", "proposed", "approved"] = "draft"
    by: Optional[str] = None
    at: Optional[str] = None
    hash: Optional[str] = None
    notes: str = ""


class MomentsFile(Strict):
    schema_: Literal["vidkit.footy-moments"] = Field(SCHEMA, alias="schema")
    version: Literal[1] = 1
    title: str = "Footy breakdown"
    series: str = "Breakdown"
    brand: str = "footy/ml"
    clips: list[Clip] = Field(default_factory=list)
    candidates: list[Candidate] = Field(default_factory=list)
    moments: list[Moment] = Field(default_factory=list)
    audio: AudioOpts = Field(default_factory=AudioOpts)
    vision: Vision = Field(default_factory=Vision)
    review: Review = Field(default_factory=Review)


# ── load / save ──────────────────────────────────────────────────────────────

def load(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save(path: Path, data: dict) -> None:
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def parse(data: dict) -> MomentsFile:
    try:
        return MomentsFile.model_validate(data)
    except ValidationError as e:
        lines = [f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in e.errors()]
        raise ValueError("moments file is invalid:\n  " + "\n  ".join(lines)) from None


def content_hash(data: dict) -> str:
    """sha256 of everything except the review block: any edit after approval breaks the match."""
    body = {k: v for k, v in data.items() if k != "review"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


# ── honesty and sanity checks ────────────────────────────────────────────────

HYPE = re.compile(r"\b(insane|unbelievable|incredible|massive|huge|epic|crazy|disaster|shocking|brilliant|terrible|worst|best ever)\b|!", re.I)
SCORE = re.compile(r"\b\d{1,2}\.\d{1,2}\s*\(\d{1,3}\)|\b\d{1,3}\s*-\s*\d{1,3}\b")
NUMBER = re.compile(r"#\s?\d{1,2}\b|\bno\.?\s?\d{1,2}\b|\bnumber\s\d{1,2}\b", re.I)
CAP_WORD = re.compile(r"\b([A-Z][a-z]+)\b")
# Capitalised words that are not names. Anything else capitalised (sentence starts included,
# where names usually sit) is flagged for checking: a few extra lines beat a missed name.
CAP_OK = set("""
The This That These Those There Here Then Now Again Also Still Just Only Even Once Twice
One Two Three Four Five Six Seven Eight Nine Ten Both Each Every Either Neither None Nobody Nothing Someone Somebody
And But Yet For Not Nor Out Off From Into Onto With Without Over Under Behind Ahead Inside Outside Between Before After
Its Him Her His Hers She They Them Their Theirs You Your Our Ours Who Whose Which What Where When Why How
Same Better Best Good Bad Late Early Too Very Much More Most Less Least Few Many All Any Some Other Another
Watch Look See Note Keep Stay Hold Lead Leads Leading Kick Kicks Mark Marks Ball Space Spacing Contest Decision
Technique Positioning Freeze Outcome Coach Team Teams Replay Placeholder Play Slow Left Right Front Back Side
Yes Let Lets Get Got Has Have Had Was Were Are Can Could Should Would Will Must Might May Did Does Don
It In On At To Of By If As Is Be Do Go No So Up We He Me My Us An Or
""".split())


def _text_flags(where: str, text: str) -> list[str]:
    out = []
    if HYPE.search(text):
        out.append(f"{where}: hype or exclamation in \"{text}\" (calm coach voice: plain sentences)")
    if SCORE.search(text):
        out.append(f"{where}: looks like a score in \"{text}\": check it against the source or remove it")
    if NUMBER.search(text):
        out.append(f"{where}: jumper number in \"{text}\": only if it is legible in the frames")
    for w in CAP_WORD.findall(text):
        if w not in CAP_OK:
            out.append(f"{where}: \"{w}\" may be a name: names only if verified from the source, never guessed")
    return out


def check(data: dict) -> tuple[list[str], list[str], MomentsFile]:
    """(errors, warnings, parsed). Errors block approval and the build."""
    mf = parse(data)
    errors: list[str] = []
    warns: list[str] = []
    clips = {c.id: c for c in mf.clips}
    if not clips:
        errors.append("no clips: run `python -m studio.footy ingest` (or `placeholder`) first")
    for c in mf.clips:
        s = c.source
        if c.placeholder:
            if s.rights != "placeholder":
                errors.append(f"clip {c.id}: placeholder clip must have rights 'placeholder'")
        else:
            if not (s.url or s.file):
                errors.append(f"clip {c.id}: log where it came from (source.url or source.file)")
            if not s.date or not re.match(r"^\d{4}-\d{2}-\d{2}$", s.date):
                errors.append(f"clip {c.id}: source.date must be the match date as YYYY-MM-DD")
            if s.rights == "unchecked":
                warns.append(f"clip {c.id}: rights unchecked — confirm you may use this clip before posting")
        if not re.match(r"^\d{2}:\d{2}:\d{2}(\.\d+)?$", s.time_range.in_) or not re.match(r"^\d{2}:\d{2}:\d{2}(\.\d+)?$", s.time_range.out):
            errors.append(f"clip {c.id}: source.time_range in/out must be HH:MM:SS.mmm")
        dur = c.frames / c.fps
        if dur > 45:
            warns.append(f"clip {c.id}: {dur:.0f} s long — keep clips to the moment plus lead-in and outcome")
    kept = [m for m in mf.moments if m.status == "keep"]
    if mf.moments and not kept:
        errors.append("every moment is dropped: nothing to render")
    ids = set()
    for m in mf.moments:
        where = f"moment {m.id}"
        if m.id in ids:
            errors.append(f"{where}: duplicate id")
        ids.add(m.id)
        c = clips.get(m.clip)
        if not c:
            errors.append(f"{where}: unknown clip {m.clip}")
            continue
        if m.status == "drop":
            if not m.drop_reason.strip():
                errors.append(f"{where}: dropped moments need a drop_reason")
            continue
        if not (0 <= m.in_f <= m.freeze_f <= m.out_f < c.frames):
            errors.append(f"{where}: need 0 <= in_f <= freeze_f <= out_f < {c.frames} (got {m.in_f}, {m.freeze_f}, {m.out_f})")
        if m.slow_until_f is not None and not (m.freeze_f <= m.slow_until_f <= m.out_f):
            errors.append(f"{where}: slow_until_f must be between freeze_f and out_f")
        if not m.title.strip():
            errors.append(f"{where}: title missing")
        if not m.category:
            errors.append(f"{where}: category missing (positioning, spacing, contest, decision or technique)")
        if not m.teaching_point.strip():
            errors.append(f"{where}: no teaching point — name one or drop the moment with a reason")
        if not m.claims:
            errors.append(f"{where}: no claims — every statement must be a claim with a confidence")
        if not m.cannot_tell:
            errors.append(f"{where}: cannot_tell is empty — say what the footage does not show (off-screen players, angle, …)")
        claims = {cl.id: cl for cl in m.claims}
        for cl in m.claims:
            if not cl.frames and cl.confidence != "unsure":
                warns.append(f"{where}: claim {cl.id} lists no frames that show it")
            for f in cl.frames:
                if not 0 <= f < c.frames:
                    errors.append(f"{where}: claim {cl.id} frame {f} outside the clip")
            warns += _text_flags(f"{where} claim {cl.id}", cl.text)
        caps = ([("watch", m.captions.watch)] if m.captions.watch else []) + [(f"freeze[{i}]", x) for i, x in enumerate(m.captions.freeze)] \
            + ([("outcome", m.captions.outcome)] if m.captions.outcome else [])
        if not m.captions.freeze:
            errors.append(f"{where}: no freeze caption")
        if len(m.captions.freeze) > 3:
            errors.append(f"{where}: {len(m.captions.freeze)} freeze captions — keep it to 3 short sentences")
        for name, cap in caps:
            w2 = f"{where} caption {name}"
            if not cap.claims:
                errors.append(f"{w2}: says something without a claim behind it (\"{cap.text}\")")
            for cid in cap.claims:
                cl = claims.get(cid)
                if not cl:
                    errors.append(f"{w2}: unknown claim {cid}")
                elif cl.confidence == "unsure":
                    errors.append(f"{w2}: rests on unsure claim {cid} — unsure claims never go on screen")
                elif cl.confidence == "likely":
                    warns.append(f"{w2}: rests on likely claim {cid} — hedge the wording (\"looks like\") or confirm it")
            if len(cap.text) > 70:
                warns.append(f"{w2}: {len(cap.text)} characters — short sentences read better at phone size")
            warns += _text_flags(w2, cap.text)
        warns += _text_flags(f"{where} title", m.title)
        for tid, t in m.tracks.items():
            if not t.keys:
                errors.append(f"{where}: track {tid} has no keys")
            for k in t.keys:
                if not 0 <= k.f < c.frames:
                    errors.append(f"{where}: track {tid} key at frame {k.f} outside the clip")
                if not (0 <= k.x <= c.width and 0 <= k.y <= c.height):
                    warns.append(f"{where}: track {tid} key f{k.f} ({k.x:.0f}, {k.y:.0f}) is off the picture")
            if t.adjust:
                warns.append(f"{where}: track {tid} ({t.label}) — ADJUST: {t.note or 'positions proposed from sampled frames; check them'}")
        if m.camera.focus and m.camera.focus not in m.tracks:
            errors.append(f"{where}: camera.focus {m.camera.focus} is not a track")
        for a in m.annotations:
            refs = [a.at, a.from_, a.to, a.via, *a.points] + ([PointRef(track=a.track)] if a.track else [])
            for r in refs:
                if r is not None and r.track and r.track not in m.tracks:
                    errors.append(f"{where}: annotation {a.id} uses unknown track {r.track}")
            for cid in a.claims:
                if cid not in claims:
                    errors.append(f"{where}: annotation {a.id} cites unknown claim {cid}")
                elif claims[cid].confidence == "unsure":
                    errors.append(f"{where}: annotation {a.id} illustrates unsure claim {cid} — unsure claims are never drawn")
            if not a.claims:
                warns.append(f"{where}: annotation {a.id} cites no claim")
            if a.adjust:
                warns.append(f"{where}: annotation {a.id} ({a.kind}) — ADJUST: {a.note or 'placed from sampled frames; check the position'}")
            if a.when in ("follow", "play", "all"):
                tr = [r.track for r in refs if r is not None and r.track]
                for tid in tr:
                    ks = [k.f for k in m.tracks[tid].keys] if tid in m.tracks else []
                    lo, hi = (m.in_f if a.when in ("play", "all") else m.freeze_f), (m.out_f if a.when in ("follow", "all") else m.freeze_f)
                    if ks and (min(ks) > lo + 2 or max(ks) < hi - 2):
                        warns.append(f"{where}: annotation {a.id} is shown f{lo}–f{hi} but track {tid} has keys only f{min(ks)}–f{max(ks)} (it holds still outside)")
        if m.voice and not Path(m.voice).suffix:
            errors.append(f"{where}: voice must be a media file path")
    if mf.candidates and all(cd.status == "proposed" and not cd.visible for cd in mf.candidates):
        warns.append("candidates have no vision notes yet (visible / why): run the vision pass")
    return errors, warns, mf


# ── review summary (markdown) ────────────────────────────────────────────────

def _tc(f: int, fps: float) -> str:
    s = f / fps
    return f"{int(s // 60):02d}:{s % 60:05.2f}"


def summary(data: dict, errors: list[str], warns: list[str], proofs: dict[str, str], base: Path) -> str:
    mf = parse(data)
    clips = {c.id: c for c in mf.clips}
    L = []
    rv = mf.review
    approved = rv.status == "approved" and rv.hash == content_hash(data)
    L.append(f"# {mf.title} — review")
    L.append("")
    L.append(f"**Status:** {'APPROVED by ' + str(rv.by) + ' at ' + str(rv.at) if approved else ('approval out of date (edited since)' if rv.status == 'approved' else rv.status.upper() + ' — not approved, nothing will render')}")
    L.append("")
    if errors:
        L.append("## Errors (must fix before approval)")
        L += [f"- {e}" for e in errors]
        L.append("")
    if warns:
        L.append("## Check these")
        L += [f"- {w}" for w in warns]
        L.append("")
    L.append("## Clips and sources")
    L.append("")
    L.append("| clip | competition | match | date | source | time range | rights | proxy |")
    L.append("|---|---|---|---|---|---|---|---|")
    for c in mf.clips:
        s = c.source
        src = s.url or s.file or ("synthetic" if c.placeholder else "—")
        L.append(f"| {c.id}{' (PLACEHOLDER)' if c.placeholder else ''} | {s.competition} | {s.match or '—'} | {s.date or '—'} | {src} | {s.time_range.in_}–{s.time_range.out} | {s.rights} | {c.width}×{c.height} @ {c.fps:g} fps, {c.frames} frames |")
    L.append("")
    if mf.vision.model or mf.vision.notes:
        L.append(f"**Vision pass:** {mf.vision.model}. {mf.vision.notes}")
        L.append("")
    if mf.candidates:
        L.append("## Candidate moments (cheap signals → vision pass)")
        L.append("")
        L.append("| # | id | frames | time | signals | visible | why it matters | status |")
        L.append("|---|---|---|---|---|---|---|---|")
        for cd in sorted(mf.candidates, key=lambda c: (c.vision_rank or 99, c.rank)):
            fps = clips[cd.clip].fps if cd.clip in clips else 25
            sig = "; ".join(f"{s.signal}@f{s.frame}" + (f" ({s.z:g}σ)" if s.z is not None else "") for s in cd.signals) or "—"
            st = cd.status + (f": {cd.drop_reason}" if cd.drop_reason else "")
            sheet = f" [sheet]({Path(cd.sheet).name if cd.sheet else ''})" if cd.sheet else ""
            L.append(f"| {cd.vision_rank or '—'} | {cd.id}{sheet} | {cd.start_f}–{cd.end_f} (peak {cd.peak_f}) | {_tc(cd.start_f, fps)}–{_tc(cd.end_f, fps)} | {sig} | {cd.visible or '—'} | {cd.why or '—'} | {st} |")
        L.append("")
    L.append("## Moments")
    for m in mf.moments:
        c = clips.get(m.clip)
        fps = c.fps if c else 25
        L.append("")
        title = re.sub(r"\[\[|\]\]|\{\{|\}\}", "", m.title).replace("\n", " ").strip()
        L.append(f"### {m.id} — {title or '(untitled)'}{' [DROPPED]' if m.status == 'drop' else ''}")
        if m.status == "drop":
            L.append(f"Dropped: {m.drop_reason}")
            continue
        L.append("")
        L.append(f"- **Category:** {m.category} · **clip** {m.clip} · in f{m.in_f} ({_tc(m.in_f, fps)}) → **freeze f{m.freeze_f} ({_tc(m.freeze_f, fps)})** → out f{m.out_f} ({_tc(m.out_f, fps)})"
                 + (f", slow to f{m.slow_until_f}" if m.slow_until_f else ""))
        L.append(f"- **Teaching point:** {m.teaching_point}")
        if m.id in proofs:
            L.append(f"- **Proof:** ![{m.id} proof]({proofs[m.id]})")
        L.append("")
        L.append("**Claims**")
        L.append("")
        for cl in m.claims:
            L.append(f"- `{cl.confidence.upper():6}` {cl.id}: {cl.text}" + (f" (frames {', '.join(map(str, cl.frames))})" if cl.frames else ""))
        L.append("")
        L.append("**Could not tell from the footage**")
        L.append("")
        L += [f"- {x}" for x in m.cannot_tell]
        L.append("")
        L.append("**On screen**")
        L.append("")
        if m.captions.watch:
            L.append(f"- Lead-in (WATCH): \"{m.captions.watch.text}\" ← {', '.join(m.captions.watch.claims)}")
        for i, cp in enumerate(m.captions.freeze):
            L.append(f"- Freeze {i + 1}: \"{cp.text}\" ← {', '.join(cp.claims)}")
        if m.captions.outcome:
            L.append(f"- Outcome: \"{m.captions.outcome.text}\" ← {', '.join(m.captions.outcome.claims)}")
        L.append("")
        L.append("**Annotations** (video px; ADJUST = proposed from sampled frames, please check)")
        L.append("")
        for a in m.annotations:
            what = a.label or a.text or ""
            L.append(f"- {a.id}: {a.kind}{(' “' + what + '”') if what else ''}, {a.when}{' — **ADJUST?** ' + a.note if a.adjust else (' — ' + a.note if a.note else '')}")
        for tid, t in m.tracks.items():
            L.append(f"- track {tid} ({t.label}, {t.point}, {t.source}): {len(t.keys)} keys f{t.keys[0].f}–f{t.keys[-1].f}{' — **ADJUST?** ' + t.note if t.adjust else ''}")
    L.append("")
    L.append("## To approve")
    L.append("")
    L.append("Edit moments.json if anything is wrong, re-run `python -m studio.footy check`, then "
             "`python -m studio.footy approve <moments.json> --by <your name>`. Any later edit voids the approval.")
    return "\n".join(L) + "\n"


def approve(path: Path, by: str, notes: str = "") -> dict:
    data = load(path)
    errors, _, _ = check(data)
    if errors:
        raise ValueError("cannot approve, fix these first:\n  " + "\n  ".join(errors))
    data["review"] = {"status": "approved", "by": by, "at": datetime.now().isoformat(timespec="seconds"),
                      "hash": content_hash(data), "notes": notes}
    save(path, data)
    return data["review"]


def require_approved(data: dict) -> None:
    rv = data.get("review") or {}
    if rv.get("status") != "approved":
        raise PermissionError("not approved: review moments.md, then run `python -m studio.footy approve <moments.json> --by <name>`")
    if rv.get("hash") != content_hash(data):
        raise PermissionError("the moments file changed after approval: re-run check, review, and approve again")
