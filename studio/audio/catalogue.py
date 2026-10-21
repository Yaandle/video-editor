"""Every sound the mixer can make: the core voices and beds, plus whatever the
installed style packs add in styles/<id>/sound.py.

A pack's sound.py defines plain functions built from studio.audio.synth:

    VOICES = {"thud": thud, ...}      # fn(seed=0, **cue) -> float32 (n, 2) at synth.SR
    BEDS = {"chiptune": chiptune}     # fn(duration, bpm, sections, seed, end_hit, offset) -> (n, 2)

They are addressed as "<pack>.<name>" in cues, sound profiles (tokens.json
"sfx") and audio.music.preset. Discovery is by folder, so a new pack needs no
edit here.
"""
from __future__ import annotations

import importlib.util
import inspect
from functools import lru_cache
from types import ModuleType

from .. import paths
from . import music, synth


@lru_cache(maxsize=None)
def pack_modules() -> dict[str, ModuleType]:
    out: dict[str, ModuleType] = {}
    if not paths.STYLES.is_dir():
        return out
    for d in sorted(paths.STYLES.iterdir()):
        f = d / "sound.py"
        if not f.is_file():
            continue
        spec = importlib.util.spec_from_file_location(f"vidkit_style_{d.name.replace('-', '_')}_sound", f)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        out[d.name] = mod
    return out


@lru_cache(maxsize=1)
def voices() -> dict:
    v = dict(synth.VOICES)
    for pid, mod in pack_modules().items():
        for name, fn in getattr(mod, "VOICES", {}).items():
            v[f"{pid}.{name}"] = fn
    return v


@lru_cache(maxsize=1)
def beds() -> dict:
    b = {"brutal-bounce": music.render_bed}
    for pid, mod in pack_modules().items():
        for name, fn in getattr(mod, "BEDS", {}).items():
            b[f"{pid}.{name}"] = fn
    return b


def voice(name: str, seed: int = 0, **cue):
    """Synthesize `name` with only the cue fields its function accepts (pitch, length, …)."""
    fn = voices().get(name)
    if fn is None:
        raise KeyError(f"unknown sound '{name}'")
    params = inspect.signature(fn).parameters
    accepts_any = any(p.kind is p.VAR_KEYWORD for p in params.values())
    kw = {k: v for k, v in cue.items() if v is not None and (accepts_any or k in params)}
    return fn(seed=seed, **kw)


def bed(name: str, **kw):
    fn = beds().get(name)
    if fn is None:
        raise KeyError(f"unknown music preset '{name}'")
    return fn(**kw)
