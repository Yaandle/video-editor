# websocket_server.py
import asyncio
import json
import os
import sys

from PIL import Image as _PILImage
if not hasattr(_PILImage, "ANTIALIAS"):
    _PILImage.ANTIALIAS = _PILImage.LANCZOS

from models import Project, new_clip
from project_store import ProjectStore

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(_BACKEND_DIR, "uploads")
PROJECTS_DIR = os.path.join(_BACKEND_DIR, "projects")
os.makedirs(PROJECTS_DIR, exist_ok=True)


def _place(natW, natH, x, y, scale, canvas_w, canvas_h):
    """Fit media into canvas (max 88% w / 80% h), return (dw, dh, dx, dy)."""
    fit_scale = min(canvas_w * 0.88 / natW, canvas_h * 0.80 / natH, 1.0)
    dw, dh = natW * fit_scale * scale, natH * fit_scale * scale
    dx, dy = x * canvas_w - dw / 2, y * canvas_h - dh / 2
    return dw, dh, dx, dy


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

        if action == "add_clip":
            from models import CLIP_TYPE_TRACK
            clip_type = msg["clip_type"]
            track = CLIP_TYPE_TRACK.get(clip_type, "visual")
            start = msg.get("start")
            if start is None:
                track_clips = [c for c in self.project.clips if c.track == track]
                start = max((c.end() for c in track_clips), default=0.0)
            self.project.clips.append(new_clip(clip_type, start))
            await self.broadcast({"type": "project", "data": self.project.to_dict()})

        elif action == "save_project":
            self.project = Project.from_dict(msg.get("data", {}))
            filename = msg.get("filename") or f"{self.project.name}.vkit"
            path = os.path.join(PROJECTS_DIR, filename)
            ProjectStore.save(self.project, path)
            await websocket.send_text(json.dumps({"type": "save_status", "status": "done", "path": path}))

        elif action == "load_project":
            filename = msg.get("filename") or f"{self.project.name}.vkit"
            path = os.path.join(PROJECTS_DIR, filename)
            self.project = ProjectStore.load(path)
            await self.broadcast({"type": "project", "data": self.project.to_dict()})

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

        CANVAS_W = project_data.get("canvas_w", 1080)
        CANVAS_H = project_data.get("canvas_h", 1920)
        FPS = project_data.get("fps", 60)
        DURATION = project_data.get("duration", 5.0)
        proj_name = project_data.get("name", "output").replace(" ", "_")
        out_path = os.path.join(UPLOAD_DIR, f"{proj_name}_output.mp4")

        def _resolve(code_file):
            rel = code_file.lstrip("/")
            if rel.startswith("media/"):
                rel = rel[len("media/"):]
            return os.path.join(UPLOAD_DIR, rel)

        try:
            video_layers = [ColorClip(size=(CANVAS_W, CANVAS_H), color=(0, 0, 0)).set_duration(DURATION)]
            audio_tracks = []

            for clip in sorted(project_data.get("clips", []), key=lambda c: c.get("layer", 0), reverse=True):
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
                        font_size = int(60 * scale)
                        rise = clip.get("text_rise_distance", 22)
                        pad_top = pad_bottom = int(rise + 30)
                        x_norm = x

                        _cache = {"t": None, "img": None}

                        def _get_frame(t, _cache=_cache):
                            if _cache["t"] != t:
                                _cache["img"] = render_narration_frame(
                                    text, anim_style, max(0.0, t) * 1000.0, clip,
                                    CANVAS_W, x_norm, font_size, pad_top, pad_bottom,
                                )
                                _cache["t"] = t
                            return _cache["img"]

                        def make_frame(t): return np.array(_get_frame(t).convert("RGB"))
                        def make_mask(t): return np.array(_get_frame(t).split()[-1]) / 255.0

                        probe_img = render_narration_frame(text, anim_style, 0, clip, CANVAS_W, x_norm, font_size, pad_top, pad_bottom)

                        tc = VideoClip(make_frame, duration=duration)
                        mc = VideoClip(make_mask, duration=duration, ismask=True)
                        tc = tc.set_mask(mc).set_start(start)
                        dy = y * CANVAS_H - pad_top
                        tc = tc.set_position((0, int(round(dy))))
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
                        sc = sc.set_position((x * CANVAS_W - fw / 2, y * CANVAS_H - fh / 2))
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
                        vc = VideoFileClip(fpath, audio=True)
                        end_in_source = min(source_start + duration, vc.duration)
                        vc = vc.subclip(source_start, end_in_source)
                        dw, dh, dx, dy = _place(*vc.size, x, y, scale, CANVAS_W, CANVAS_H)
                        vc = vc.resize((int(round(dw)), int(round(dh)))).set_position((dx, dy)).set_start(start)
                        if vc.audio is not None:
                            audio_tracks.append(vc.audio.set_start(start))
                            vc = vc.without_audio()
                        video_layers.append(vc)
                    except Exception as exc:
                        print(f"[render] WARNING: video load failed ({src}): {exc}", file=sys.stderr)
                    continue

                # ── IMAGE ──
                if ctype == "image":
                    try:
                        ic = ImageClip(fpath, duration=duration)
                        dw, dh, dx, dy = _place(*ic.size, x, y, scale, CANVAS_W, CANVAS_H)
                        ic = ic.resize((int(round(dw)), int(round(dh)))).set_position((dx, dy)).set_start(start)
                        video_layers.append(ic)
                    except Exception as exc:
                        print(f"[render] WARNING: image load failed ({src}): {exc}", file=sys.stderr)
                    continue

            final_video = CompositeVideoClip(video_layers, size=(CANVAS_W, CANVAS_H), use_bgclip=True).set_duration(DURATION)
            if audio_tracks:
                final_video = final_video.set_audio(CompositeAudioClip(audio_tracks))

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
            await websocket.send_text(json.dumps({
                "type": "render_status", "status": "error",
                "message": str(exc), "detail": traceback.format_exc()[-800:],
            }))

            
    async def handler(self, websocket):
        await websocket.accept()
        await self.register(websocket)
        try:
            while True:
                raw = await websocket.receive_text()
                await self.handle_message(websocket, raw)
        except Exception:
            pass
        finally:
            await self.unregister(websocket)