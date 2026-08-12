# websocket_server.py
import asyncio
import json
import os
import sys

from PIL import Image as _PILImage
if not hasattr(_PILImage, "ANTIALIAS"):
    _PILImage.ANTIALIAS = _PILImage.LANCZOS

from models import Project
from project_store import ProjectStore

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(_BACKEND_DIR, "uploads")
SFX_DIR = os.path.join(_BACKEND_DIR, "sfx")  # #72 — built-in sound effects
PROJECTS_DIR = os.path.join(_BACKEND_DIR, "projects")
os.makedirs(PROJECTS_DIR, exist_ok=True)


def _place(natW, natH, x, y, scale_x, scale_y, canvas_w, canvas_h):
    """Fit media into canvas (max 88% w / 80% h), return (dw, dh, dx, dy).
    Mirrors canvas.js _drawMedia: independent scale_x/scale_y on top of fit."""
    fit_scale = min(canvas_w * 0.88 / natW, canvas_h * 0.80 / natH, 1.0)
    dw, dh = natW * fit_scale * scale_x, natH * fit_scale * scale_y
    dx, dy = x * canvas_w - dw / 2, y * canvas_h - dh / 2
    return dw, dh, dx, dy


def _sorted_keyframes(raw):
    """Normalize + sort clip.motion_keyframes for interpolation. Returns
    None when there's nothing to animate (mirrors canvas.js resolvePos)."""
    if not raw or len(raw) < 2:
        return None
    try:
        kfs = sorted(
            (
                {
                    "t": float(k.get("t", 0)),
                    "x": float(k.get("x", 0.5)),
                    "y": float(k.get("y", 0.5)),
                    "scale": k.get("scale"),
                }
                for k in raw
            ),
            key=lambda k: k["t"],
        )
        return kfs
    except Exception:
        return None


def _kf_interp(kfs, frac, key, default):
    """Piecewise-linear interpolation across sorted keyframes at `frac`
    (0-1 of the clip's own duration). Mirrors canvas.js resolvePos()."""
    frac = max(0.0, min(1.0, frac))
    a, b = kfs[0], kfs[-1]
    for i in range(len(kfs) - 1):
        if kfs[i]["t"] <= frac <= kfs[i + 1]["t"]:
            a, b = kfs[i], kfs[i + 1]
            break
    span = (b["t"] - a["t"]) or 1.0
    p = max(0.0, min(1.0, (frac - a["t"]) / span))
    va = a.get(key)
    vb = b.get(key)
    va = default if va is None else va
    vb = default if vb is None else vb
    return va + (vb - va) * p


def _apply_motion_keyframes(mclip, kfs, nat_w, nat_h, base_scale, canvas_w, canvas_h, duration):
    """
    Ken Burns style pan/zoom for export: drives a dynamic resize+position
    across clip.motion_keyframes instead of the static _place() call, so a
    clip can zoom into a feature, pan to another, and zoom back out in the
    rendered file too — not just the live canvas preview.
    """
    fit_scale = min(canvas_w * 0.88 / nat_w, canvas_h * 0.80 / nat_h, 1.0)

    def factor(t):
        frac = (t / duration) if duration > 0 else 0.0
        s = _kf_interp(kfs, frac, "scale", base_scale)
        return max(0.001, fit_scale * s)

    def pos(t):
        frac = (t / duration) if duration > 0 else 0.0
        ix = _kf_interp(kfs, frac, "x", 0.5)
        iy = _kf_interp(kfs, frac, "y", 0.5)
        s = _kf_interp(kfs, frac, "scale", base_scale)
        dw, dh = nat_w * fit_scale * s, nat_h * fit_scale * s
        return (ix * canvas_w - dw / 2, iy * canvas_h - dh / 2)

    return mclip.resize(factor).set_position(pos)


def _apply_crop(mclip, clip):
    """
    #28 — crop an image/video source to clip.crop_x/y/w/h (normalized 0-1
    rect in the source's natural pixels) before any resize/position math
    runs, so downstream fit-to-canvas sizing is based on the cropped
    dimensions — mirrors canvas.js _drawMedia's 9-arg drawImage crop.
    """
    crop_x = float(clip.get("crop_x", 0) or 0)
    crop_y = float(clip.get("crop_y", 0) or 0)
    crop_w = float(clip.get("crop_w", 1) or 1)
    crop_h = float(clip.get("crop_h", 1) or 1)
    if crop_x <= 0.001 and crop_y <= 0.001 and crop_w >= 0.999 and crop_h >= 0.999:
        return mclip  # full frame — nothing to do

    nat_w, nat_h = mclip.size
    x1 = max(0, min(nat_w - 1, crop_x * nat_w))
    y1 = max(0, min(nat_h - 1, crop_y * nat_h))
    x2 = max(x1 + 1, min(nat_w, (crop_x + crop_w) * nat_w))
    y2 = max(y1 + 1, min(nat_h, (crop_y + crop_h) * nat_h))

    from moviepy.video.fx.all import crop as _crop_fx
    return mclip.fx(_crop_fx, x1=x1, y1=y1, x2=x2, y2=y2)


_SLIDE_OFFSETS = {
    # #63 — direction the clip travels FROM when sliding in (canvas fractions)
    "slide_up": (0, 1), "slide_down": (0, -1),
    "slide_left": (1, 0), "slide_right": (-1, 0),
}


def _apply_transitions(mclip, clip, base_pos, canvas_w, canvas_h):
    """
    #63 — mirror canvas.js's _transitionState at render time.
    Fades map to crossfadein/out; slides animate position with the same
    ease-out-cubic decay as the preview; scale_pop falls back to fade
    (moviepy 1.x has no cheap per-frame scale about a point).
    """
    t_in = clip.get("transition_in")
    t_out = clip.get("transition_out")
    if not t_in and not t_out:
        return mclip

    dur = mclip.duration or float(clip.get("duration", 5))
    in_d = min(max(0.01, float(clip.get("transition_in_ms") or 500) / 1000.0), dur)
    out_d = min(max(0.01, float(clip.get("transition_out_ms") or 500) / 1000.0), dur)
    bx, by = base_pos

    if "scale_pop" in (t_in, t_out):
        # Intentional: moviepy 1.x has no cheap per-frame scale about a point,
        # so scale_pop renders as a plain crossfade. The canvas preview still
        # shows the real pop — this note flags the mismatch for developers.
        print("[render] note: scale_pop transition falls back to crossfade at render time", file=sys.stderr)

    if t_in in ("fade", "scale_pop"):
        mclip = mclip.crossfadein(in_d)
    if t_out in ("fade", "scale_pop"):
        mclip = mclip.crossfadeout(out_d)

    if t_in in _SLIDE_OFFSETS or t_out in _SLIDE_OFFSETS:
        inx, iny = _SLIDE_OFFSETS.get(t_in, (0, 0))
        outx, outy = _SLIDE_OFFSETS.get(t_out, (0, 0))

        def pos(t):
            x_, y_ = bx, by
            if t_in in _SLIDE_OFFSETS and t < in_d:
                p = (1 - t / in_d) ** 3  # ease-out cubic, matches canvas.js
                x_ += inx * canvas_w * 1.1 * p
                y_ += iny * canvas_h * 1.1 * p
            remain = dur - t
            if t_out in _SLIDE_OFFSETS and remain < out_d:
                p = (1 - remain / out_d) ** 3
                x_ += outx * canvas_w * 1.1 * p
                y_ += outy * canvas_h * 1.1 * p
            return (x_, y_)

        mclip = mclip.set_position(pos)
        if t_in in _SLIDE_OFFSETS:
            mclip = mclip.crossfadein(min(in_d * 0.6, dur))
        if t_out in _SLIDE_OFFSETS:
            mclip = mclip.crossfadeout(min(out_d * 0.6, dur))

    return mclip


class VideoEditorServer:
    def __init__(self):
        self.project = Project()
        self.clients = set()

    async def register(self, websocket):
        self.clients.add(websocket)
        await websocket.send_text(json.dumps({"type": "project", "data": self.project.to_dict()}))

    async def unregister(self, websocket):
        self.clients.discard(websocket)

    async def broadcast(self, message):
        if not self.clients:
            return
        await asyncio.gather(*[c.send_text(json.dumps(message)) for c in self.clients])

    async def handle_message(self, websocket, raw):
        msg = json.loads(raw)
        action = msg.get("action") or msg.get("type")

        if action == "save_project":
            self.project = Project.from_dict(msg.get("data", {}))
            filename = os.path.basename(msg.get("filename") or f"{self.project.name}.vkit")
            if not filename.endswith(".vkit"):
                filename += ".vkit"
            path = os.path.join(PROJECTS_DIR, filename)
            # File I/O + json (de)serialization is sync; a large project would
            # otherwise stall this event loop — and every connected client's
            # websocket — for the duration of the write.
            await asyncio.get_event_loop().run_in_executor(None, ProjectStore.save, self.project, path)
            await websocket.send_text(json.dumps({"type": "save_status", "status": "done", "path": path, "filename": filename}))

        elif action == "load_project":
            filename = os.path.basename(msg.get("filename") or f"{self.project.name}.vkit")
            path = os.path.join(PROJECTS_DIR, filename)
            if not os.path.isfile(path):
                await websocket.send_text(json.dumps({"type": "save_status", "status": "error", "message": f"Project not found: {filename}"}))
                return
            self.project = await asyncio.get_event_loop().run_in_executor(None, ProjectStore.load, path)
            await self.broadcast({"type": "project", "data": self.project.to_dict(), "filename": filename})

        elif action == "delete_project":
            filename = os.path.basename(msg.get("filename") or "")

            success, message = ProjectStore.delete(
                os.path.join(PROJECTS_DIR, filename)
            )

            await websocket.send_json({
                "type": "delete_project_result",
                "success": success,
                "filename": filename,
                "message": message,
            }) 

        elif action == "render":
            project_data = msg.get("data") or self.project.to_dict()
            await websocket.send_text(json.dumps({"type": "render_status", "status": "started", "message": "Render queued"}))
            try:
                first_narr = next((c.get("content") for c in project_data.get("clips", []) if c.get("clip_type") == "narration"), None)
                print(f"[render] queued: project={project_data.get('name')!r}, clips={len(project_data.get('clips', []))}, first_narration={first_narr!r}", file=sys.stderr)
            except Exception:
                pass
            asyncio.create_task(self._run_render(websocket, project_data))

    async def _run_render(self, websocket, project_data):
        """
        moviepy 1.x composite render.
        Supported clip types: video, image, audio, narration, shape.
        Skipped: code, graph.
        Emits render_status: started → done | error
        """
        from moviepy.editor import (
            VideoFileClip, ImageClip, ColorClip,
            CompositeVideoClip, AudioFileClip, CompositeAudioClip,
        )
        from moviepy.video.fx.all import speedx

        CANVAS_W = project_data.get("canvas_w", 1080)
        CANVAS_H = project_data.get("canvas_h", 1920)
        FPS = project_data.get("fps", 60)
        DURATION = project_data.get("duration", 5.0)
        proj_name = project_data.get("name", "output").replace(" ", "_")
        out_path = os.path.join(UPLOAD_DIR, f"{proj_name}_output.mp4")
        # #71 — hidden layers (eye icon off in the timeline) are muted from
        # the rendered output too, same as the live preview.
        hidden_layers = set(project_data.get("hidden_layers", []))

        def _resolve(code_file):
            rel = code_file.lstrip("/")
            if rel.startswith("media/"):
                return os.path.join(UPLOAD_DIR, rel[len("media/"):])
            if rel.startswith("sfx/"):
                # #72 — sound-effect clips reference /sfx/<file>, generated
                # into backend/sfx/ rather than the uploads folder.
                return os.path.join(SFX_DIR, rel[len("sfx/"):])
            return os.path.join(UPLOAD_DIR, rel)

        stage = "compose"  # compose → encode; reported in render_status errors
        try:
            video_layers = [ColorClip(size=(CANVAS_W, CANVAS_H), color=(0, 0, 0)).set_duration(DURATION)]
            audio_tracks = []

            for clip in sorted(project_data.get("clips", []), key=lambda c: c.get("layer", 0), reverse=True):
                if clip.get("layer", 0) in hidden_layers:
                    continue
                ctype = clip.get("clip_type", "")
                src = clip.get("code_file") or clip.get("src") or ""
                start = float(clip.get("start", 0))
                duration = float(clip.get("duration", 5))
                x, y, scale = float(clip.get("x", 0.5)), float(clip.get("y", 0.5)), float(clip.get("scale", 1.0))
                scale_x = float(clip.get("scale_x", scale))
                scale_y = float(clip.get("scale_y", scale))

                if ctype in ("code", "graph"):
                    continue
                if not src and ctype not in ("narration", "shape"):
                    continue

                # ── NARRATION ──
                if ctype == "narration":
                    text = clip.get("content", "").strip()
                    if not text:
                        print("[render] WARNING: narration clip has empty content", file=sys.stderr)
                        continue
                    try:
                        from moviepy.editor import VideoClip
                        from text_anim import render_narration_frame
                        import numpy as np

                        anim_style = clip.get("text_anim_style")
                        anim_delay_s = float(clip.get("text_delay_ms", 0) or 0) / 1000.0  # #66
                        font_color = clip.get("font_color") or (255, 255, 255)  # parity with canvas preview
                        font_size = int(clip.get("font_size") or (60 * scale))
                        rise = clip.get("text_rise_distance", 22)
                        pad_top = pad_bottom = int(rise + 30)
                        x_norm = x

                        _cache = {"t": None, "img": None}

                        def _get_frame(t, _cache=_cache):
                            if _cache["t"] != t:
                                # #66 — animation clock starts after text_delay_ms
                                _cache["img"] = render_narration_frame(
                                    text, anim_style, (max(0.0, t) - anim_delay_s) * 1000.0, clip,
                                    CANVAS_W, x_norm, font_size, pad_top, pad_bottom,
                                    color=font_color, scale_x=scale_x,
                                )
                                _cache["t"] = t
                            return _cache["img"]

                        def make_frame(t): return np.array(_get_frame(t).convert("RGB"))
                        def make_mask(t): return np.array(_get_frame(t).split()[-1]) / 255.0

                        probe_img = render_narration_frame(text, anim_style, 0, clip, CANVAS_W, x_norm, font_size, pad_top, pad_bottom, color=font_color, scale_x=scale_x)

                        tc = VideoClip(make_frame, duration=duration)
                        mc = VideoClip(make_mask, duration=duration, ismask=True)
                        tc = tc.set_mask(mc).set_start(start)
                        dy = y * CANVAS_H - pad_top
                        tc = tc.set_position((0, int(round(dy))))
                        tc = _apply_transitions(tc, clip, (0, int(round(dy))), CANVAS_W, CANVAS_H)
                        video_layers.append(tc)
                        print(f"[render] narration OK ({anim_style or 'static'}): {probe_img.height}px block at y={dy:.0f}", file=sys.stderr)
                    except Exception as exc:
                        import traceback
                        print(f"[render] ERROR: narration render failed: {exc}", file=sys.stderr)
                        print(traceback.format_exc(), file=sys.stderr)
                    continue

                # ── SHAPE ──
                if ctype == "shape":
                    try:
                        from PIL import Image, ImageDraw
                        import math, numpy as np

                        shape_kind = clip.get("shape_kind", "rectangle")
                        fill = clip.get("fill", "#FFFFFF")
                        stroke_color = clip.get("stroke_color", "#000000")
                        stroke_width = float(clip.get("stroke_width", 0))
                        corner_r = float(clip.get("corner_radius", 0))
                        rotation = float(clip.get("rotation", 0))
                        opacity = float(clip.get("opacity", 1.0))
                        sides = int(clip.get("sides", 5))
                        points_n = int(clip.get("points", 5))
                        inner_ratio = float(clip.get("inner_radius_ratio", 0.5))

                        BASE_W, BASE_H = 200, 200
                        fit_scale = min(CANVAS_W * 0.88 / BASE_W, CANVAS_H * 0.80 / BASE_H, 1.0)
                        dw, dh = BASE_W * fit_scale * scale_x, BASE_H * fit_scale * scale_y

                        pad = int(max(dw, dh) * 0.5) + int(stroke_width) + 4
                        tile_w, tile_h = int(dw) + pad * 2, int(dh) + pad * 2
                        img = Image.new("RGBA", (tile_w, tile_h), (0, 0, 0, 0))
                        draw = ImageDraw.Draw(img)

                        x0, y0, x1, y1 = pad, pad, pad + dw, pad + dh
                        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

                        def _ngon_points(n, cx, cy, r, rot=-90, inner_r=None):
                            pts, total = [], n * (2 if inner_r is not None else 1)
                            for i in range(total):
                                ang = math.radians(rot + i * (360 / total))
                                rad = r if (inner_r is None or i % 2 == 0) else inner_r
                                pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
                            return pts

                        stroke_arg = stroke_color if stroke_width > 0 else None
                        sw_arg = int(stroke_width) if stroke_width > 0 else 0

                        if shape_kind == "rectangle":
                            if corner_r > 0:
                                draw.rounded_rectangle([x0, y0, x1, y1], radius=corner_r, fill=fill, outline=stroke_arg, width=sw_arg)
                            else:
                                draw.rectangle([x0, y0, x1, y1], fill=fill, outline=stroke_arg, width=sw_arg)
                        elif shape_kind == "circle":
                            draw.ellipse([x0, y0, x1, y1], fill=fill, outline=stroke_arg, width=sw_arg)
                        elif shape_kind == "triangle":
                            pts = [(cx, y0), (x1, y1), (x0, y1)]
                            draw.polygon(pts, fill=fill, outline=stroke_arg)
                            if sw_arg: draw.line(pts + [pts[0]], fill=stroke_color, width=sw_arg)
                        elif shape_kind == "polygon":
                            pts = _ngon_points(max(3, sides), cx, cy, min(dw, dh) / 2)
                            draw.polygon(pts, fill=fill, outline=stroke_arg)
                            if sw_arg: draw.line(pts + [pts[0]], fill=stroke_color, width=sw_arg)
                        elif shape_kind == "star":
                            r = min(dw, dh) / 2
                            pts = _ngon_points(max(2, points_n), cx, cy, r, inner_r=r * inner_ratio)
                            draw.polygon(pts, fill=fill, outline=stroke_arg)
                            if sw_arg: draw.line(pts + [pts[0]], fill=stroke_color, width=sw_arg)
                        elif shape_kind == "line":
                            draw.line([(x0, cy), (x1, cy)], fill=stroke_color or fill, width=max(sw_arg, 2))
                        elif shape_kind == "arrow":
                            shaft_w, head_w, head_len = dh * 0.25, dh * 0.6, dw * 0.35
                            shaft = [(x0, cy - shaft_w/2), (x1 - head_len, cy - shaft_w/2), (x1 - head_len, cy + shaft_w/2), (x0, cy + shaft_w/2)]
                            head = [(x1 - head_len, cy - head_w/2), (x1, cy), (x1 - head_len, cy + head_w/2)]
                            draw.polygon(shaft, fill=fill, outline=stroke_arg)
                            draw.polygon(head, fill=fill, outline=stroke_arg)

                        if opacity < 1.0:
                            r_, g_, b_, a_ = img.split()
                            a_ = a_.point(lambda px: int(px * opacity))
                            img = Image.merge("RGBA", (r_, g_, b_, a_))
                        if rotation:
                            img = img.rotate(-rotation, resample=Image.BICUBIC, expand=True)

                        arr = np.array(img)
                        sc = ImageClip(arr, duration=duration).set_start(start)
                        fw, fh = img.size
                        base = (x * CANVAS_W - fw / 2, y * CANVAS_H - fh / 2)
                        sc = sc.set_position(base)
                        sc = _apply_transitions(sc, clip, base, CANVAS_W, CANVAS_H)
                        video_layers.append(sc)
                    except Exception as exc:
                        import traceback
                        print(f"[render] ERROR: shape render failed: {exc}", file=sys.stderr)
                        print(traceback.format_exc(), file=sys.stderr)
                    continue

                fpath = _resolve(src)
                if not os.path.isfile(fpath):
                    print(f"[render] WARNING: file not found, skipping — {fpath}", file=sys.stderr)
                    continue

                # ── AUDIO ──
                if ctype == "audio":
                    try:
                        source_start = float(clip.get("source_start", 0))
                        audio = AudioFileClip(fpath)
                        end_in_source = min(source_start + duration, audio.duration)
                        audio_tracks.append(audio.subclip(source_start, end_in_source).set_start(start))
                    except Exception as exc:
                        print(f"[render] WARNING: audio load failed ({src}): {exc}", file=sys.stderr)
                    continue

                # ── VIDEO ──
                if ctype == "video":
                    try:
                        source_start = float(clip.get("source_start", 0))
                        speed = float(clip.get("speed", 1.0) or 1.0)
                        speed = max(0.1, min(8.0, speed))
                        vc = VideoFileClip(fpath, audio=True)
                        vc = _apply_crop(vc, clip)  # #28
                        # Speed maps timeline duration -> a larger/smaller span of
                        # source footage: 1s of timeline consumes `speed` seconds
                        # of source, so the clip appears to play faster/slower
                        # while keeping the authored timeline duration.
                        end_in_source = min(source_start + duration * speed, vc.duration)
                        vc = vc.subclip(source_start, end_in_source)
                        if speed != 1.0:
                            vc = vc.fx(speedx, speed)

                        rotation = float(clip.get("rotation", 0) or 0)
                        kfs = _sorted_keyframes(clip.get("motion_keyframes"))

                        if kfs and not rotation:
                            # Animate Position/Zoom — Ken Burns pan/zoom driven by
                            # the clip's own keyframes, mirrors canvas.js resolvePos.
                            nat_w, nat_h = vc.size
                            vc = _apply_motion_keyframes(vc, kfs, nat_w, nat_h, scale_x, CANVAS_W, CANVAS_H, duration)
                            dx, dy = x * CANVAS_W - nat_w / 2, y * CANVAS_H - nat_h / 2  # transitions fallback
                        else:
                            dw, dh, dx, dy = _place(*vc.size, x, y, scale_x, scale_y, CANVAS_W, CANVAS_H)
                            vc = vc.resize((int(round(dw)), int(round(dh))))
                            if rotation:
                                vc = vc.rotate(-rotation, expand=True)
                                rw, rh = vc.size
                                dx, dy = x * CANVAS_W - rw / 2, y * CANVAS_H - rh / 2
                            vc = vc.set_position((dx, dy))
                            if kfs:
                                print("[render] note: Animate Position/Zoom + rotation isn't supported together at render time — using the static position instead", file=sys.stderr)

                        vc = vc.set_start(start)
                        if vc.audio is not None:
                            audio_tracks.append(vc.audio.set_start(start))
                            vc = vc.without_audio()
                        vc = _apply_transitions(vc, clip, (dx, dy), CANVAS_W, CANVAS_H)
                        video_layers.append(vc)
                    except Exception as exc:
                        print(f"[render] WARNING: video load failed ({src}): {exc}", file=sys.stderr)
                    continue

                # ── IMAGE ──
                if ctype == "image":
                    try:
                        ic = ImageClip(fpath, duration=duration)
                        ic = _apply_crop(ic, clip)  # #28
                        rotation = float(clip.get("rotation", 0) or 0)
                        kfs = _sorted_keyframes(clip.get("motion_keyframes"))

                        if kfs and not rotation:
                            nat_w, nat_h = ic.size
                            ic = _apply_motion_keyframes(ic, kfs, nat_w, nat_h, scale_x, CANVAS_W, CANVAS_H, duration)
                            dx, dy = x * CANVAS_W - nat_w / 2, y * CANVAS_H - nat_h / 2  # transitions fallback
                        else:
                            dw, dh, dx, dy = _place(*ic.size, x, y, scale_x, scale_y, CANVAS_W, CANVAS_H)
                            ic = ic.resize((int(round(dw)), int(round(dh))))
                            if rotation:
                                ic = ic.rotate(-rotation, expand=True)
                                rw, rh = ic.size
                                dx, dy = x * CANVAS_W - rw / 2, y * CANVAS_H - rh / 2
                            ic = ic.set_position((dx, dy))
                            if kfs:
                                print("[render] note: Animate Position/Zoom + rotation isn't supported together at render time — using the static position instead", file=sys.stderr)

                        ic = ic.set_start(start)
                        ic = _apply_transitions(ic, clip, (dx, dy), CANVAS_W, CANVAS_H)
                        video_layers.append(ic)
                    except Exception as exc:
                        print(f"[render] WARNING: image load failed ({src}): {exc}", file=sys.stderr)
                    continue

            final_video = CompositeVideoClip(video_layers, size=(CANVAS_W, CANVAS_H), use_bgclip=True).set_duration(DURATION)
            if audio_tracks:
                final_video = final_video.set_audio(CompositeAudioClip(audio_tracks))

            stage = "encode"
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, lambda: final_video.write_videofile(
                out_path, fps=FPS, codec="libx264", audio_codec="aac", preset="slow",
                ffmpeg_params=[
                    "-crf", "18", "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p",
                    "-b:v", "10M", "-maxrate", "12M", "-bufsize", "24M", "-ar", "48000", "-b:a", "320k",
                ],
                logger=None,
            ))

            await websocket.send_text(json.dumps({
                "type": "render_status", "status": "done",
                "message": f"Rendered → {out_path}", "path": f"/media/{proj_name}_output.mp4",
            }))
        except Exception as exc:
            import traceback
            # Classify so the frontend can show something better than
            # "render error". `code` is stable; `message` is human-readable.
            if isinstance(exc, ImportError):
                code, hint = "dependency_missing", "A required render dependency (moviepy/numpy/Pillow) failed to import."
            elif isinstance(exc, FileNotFoundError):
                code, hint = "missing_media", "A media file referenced by the project could not be found."
            elif isinstance(exc, MemoryError):
                code, hint = "out_of_memory", "The project is too large to render in memory."
            elif stage == "encode":
                code, hint = "encode_failed", "ffmpeg failed while writing the output file."
            else:
                code, hint = "compose_failed", "Building the composite video failed."
            print(f"[render] ERROR ({code}, stage={stage}): {exc}", file=sys.stderr)
            print(traceback.format_exc(), file=sys.stderr)
            await websocket.send_text(json.dumps({
                "type": "render_status", "status": "error",
                "code": code, "stage": stage,
                "message": f"{hint} ({exc})",
                "detail": traceback.format_exc()[-800:],
            }))

            
    async def handler(self, websocket):
        await websocket.accept()
        await self.register(websocket)
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    await self.handle_message(websocket, raw)
                except Exception as exc:
                    import traceback
                    print(f"[ws] error handling message: {exc}", file=sys.stderr)
                    print(traceback.format_exc(), file=sys.stderr)
                    try:
                        await websocket.send_text(json.dumps({
                            "type": "save_status", "status": "error", "message": str(exc),
                        }))
                    except Exception:
                        pass
        except Exception:
            pass
        finally:
            await self.unregister(websocket)