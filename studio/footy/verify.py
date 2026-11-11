"""Check a finished render: every freeze shows exactly its frame, for the whole hold.

Three independent checks:
  1. the renderer's own per-frame report (frames.jsonl): the source frame each
     output frame drew, against the plan;
  2. the decode path the renderer uses (renders/.cache/vframes, ffmpeg at the
     proxy's rate) against an exact frame-count decode (select=eq(n,F)) of the
     same proxy: the pixels must match;
  3. for the placeholder, the frame's own barcode, read from that decode.
"""
from __future__ import annotations

import io
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

from .. import config, paths
from ..render import vframes
from . import placeholder
from .build import node


def exact_frame(proxy: Path, f: int) -> np.ndarray:
    r = subprocess.run([config.ffmpeg(), "-v", "error", "-i", str(proxy), "-vf", f"select=eq(n\\,{f})", "-fps_mode", "passthrough",
                        "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True, env=config.subprocess_env())
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError(f"could not decode frame {f} of {proxy.name}")
    return np.asarray(Image.open(io.BytesIO(r.stdout)).convert("RGB"), np.int16)


def verify(render: Path, project_path: Path) -> dict:
    project = json.loads(project_path.read_text(encoding="utf-8"))
    fps = project["settings"]["fps"]
    jsonl = render.with_suffix(".frames.jsonl")
    shown: dict[int, int] = {}
    if jsonl.is_file():
        for line in jsonl.read_text(encoding="utf-8").splitlines():
            rep = json.loads(line)
            for b in rep["boxes"]:
                if b.get("role") == "source-frame":
                    shown[int(round(rep["frame"]))] = int(b["text"])
    out = {"render": paths.rel(render), "moments": [], "ok": True, "report_frames": len(shown)}
    for c in project["clips"]:
        if c["type"] != "scene.footy-breakdown":
            continue
        props = c["props"]
        p = node("plan", {"clip": props["clip"], "moments": props["moments"], "fps": fps, "timing": props.get("timing", {})})
        f0 = int(round(c["start"] * fps))
        proxy = paths.ROOT / c["src"]
        for rec in p["moments"]:
            F = rec["freeze_f"]
            res = {"clip": c["id"], "moment": rec["id"], "freeze_f": F,
                   "freeze_out_frames": [f0 + rec["freeze0"], f0 + rec["hold1"] - 1]}
            # 1. what the renderer drew
            span = range(f0 + rec["freeze0"], f0 + rec["hold1"])
            have = [shown.get(n) for n in span]
            res["report_checked"] = sum(v is not None for v in have)
            res["report_wrong"] = [(n, v) for n, v in zip(span, have) if v is not None and v != F]
            before = shown.get(f0 + rec["freeze0"] - 1)
            res["frame_before_freeze"] = before
            # 2. decode path vs exact decode
            png = vframes.frame_path(c["src"], float(props["clip"]["fps"]), F)
            got = np.asarray(Image.open(png).convert("RGB"), np.int16)
            ref = exact_frame(proxy, F)
            res["decode_mean_abs_diff"] = round(float(np.abs(got - ref).mean()), 4) if got.shape == ref.shape else None
            # neighbours must differ, or the check proves nothing (static shots)
            try:
                nb = exact_frame(proxy, F + 1)
                res["neighbour_mean_abs_diff"] = round(float(np.abs(nb - ref).mean()), 4)
            except RuntimeError:
                res["neighbour_mean_abs_diff"] = None
            # 3. the placeholder's own frame number
            if props["clip"].get("placeholder"):
                res["barcode"] = placeholder.barcode(Image.open(png))
            ok = (not res["report_wrong"] and res["report_checked"] == len(span) and (before is None or before < F)
                  and res["decode_mean_abs_diff"] == 0 and (res.get("barcode", F) == F))
            res["ok"] = bool(ok)
            out["ok"] = out["ok"] and ok
            out["moments"].append(res)
    return out
