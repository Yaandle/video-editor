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
UPLOAD_DIR   = os.path.join(_BACKEND_DIR, "uploads")
PROJECTS_DIR = os.path.join(_BACKEND_DIR, "projects")
os.makedirs(PROJECTS_DIR, exist_ok=True)

class VideoEditorServer:

    def __init__(self):
        self.project = Project()
        self.clients = set()

    async def register(self, websocket):
        self.clients.add(websocket)
        await websocket.send_text(
            json.dumps({
                "type": "project",
                "data": self.project.to_dict()
            })
        )

    async def unregister(self, websocket):
        self.clients.discard(websocket)

    async def broadcast(self, message):
        if not self.clients:
            return
        await asyncio.gather(
            *[
                client.send_text(json.dumps(message))
                for client in self.clients
            ]
        )

    async def handle_message(self, websocket, raw):
        msg    = json.loads(raw)
        action = msg.get("action") or msg.get("type")

        if action == "add_clip":
            clip = new_clip(
                msg["clip_type"],
                msg.get("start", 0)
            )
            self.project.clips.append(clip)
            await self.broadcast({
                "type": "project",
                "data": self.project.to_dict()
            })

        elif action == "save_project":
            self.project = Project.from_dict(msg.get("data", {}))
            filename = msg.get("filename") or f"{self.project.name}.vkit"
            path = os.path.join(PROJECTS_DIR, filename)
            ProjectStore.save(self.project, path)
            await websocket.send_text(json.dumps({
                "type": "save_status",
                "status": "done",
                "path": path,
            })) 

        elif action == "load_project":
            filename = msg.get("filename") or f"{self.project.name}.vkit"
            path = os.path.join(PROJECTS_DIR, filename)
            self.project = ProjectStore.load(path)
            await self.broadcast({
                "type": "project",
                "data": self.project.to_dict()
            })

        elif action == "render":
            project_data = msg.get("data", {})
            await websocket.send_text(json.dumps({
                "type": "render_status",
                "status": "started",
                "message": "Render queued"
            }))
            asyncio.create_task(
                self._run_render(websocket, project_data)
            )

    async def _run_render(self, websocket, project_data):
        """
        moviepy 1.x composite render.

        Supported clip types:  video, image, audio
        Silently skipped:      narration, code, graph

        Emits render_status:   started → done | error
        """
        from moviepy.editor import (
            VideoFileClip,
            ImageClip,
            ColorClip,
            CompositeVideoClip,
            AudioFileClip,
            CompositeAudioClip,
        )

        CANVAS_W  = project_data.get("canvas_w",  1080)
        CANVAS_H  = project_data.get("canvas_h",  1920)
        FPS       = project_data.get("fps",        60)
        DURATION  = project_data.get("duration",   5.0)
        proj_name = project_data.get("name", "output").replace(" ", "_")
        out_path  = os.path.join(UPLOAD_DIR, f"{proj_name}_output.mp4")

        def _resolve(code_file: str) -> str:
            """Strip the leading /media/ prefix and map to an upload path."""
            rel = code_file.lstrip("/")
            if rel.startswith("media/"):
                rel = rel[len("media/"):]
            return os.path.join(UPLOAD_DIR, rel)

        try:
            video_layers: list = []
            audio_tracks: list = []

            # ── Black background ──────────────────────────────────────────────────
            bg = ColorClip(size=(CANVAS_W, CANVAS_H), color=(0, 0, 0)).set_duration(DURATION)
            video_layers.append(bg)

            # ── Process clips ─────────────────────────────────────────────────────
            for clip in project_data.get("clips", []):
                ctype    = clip.get("clip_type", "")
                src      = clip.get("code_file") or clip.get("src") or ""
                start    = float(clip.get("start", 0))
                duration = float(clip.get("duration", 5))

                # canvas.js stores normalized coordinates (0..1)
                x        = float(clip.get("x", 0.5))
                y        = float(clip.get("y", 0.5))
                scale    = float(clip.get("scale", 1.0))

                # Skip unsupported types
                if ctype in ("code", "graph"):
                    continue

                if not src and ctype != "narration":
                    continue

                # ------------------------------------------------------------------
                # NARRATION  (Pillow text overlay — no ImageMagick needed)
                # ------------------------------------------------------------------
                if ctype == "narration":
                    text = clip.get("content", "").strip()
                    if not text:
                        print("[render] WARNING: narration clip has empty content", file=sys.stderr)
                        continue
                    try:
                        from PIL import Image, ImageDraw, ImageFont
                        import numpy as np
                        from moviepy.editor import ImageClip

                        # ── Canvas for text ───────────────────────────────────────
                        text_canvas_w = int(CANVAS_W * 0.85)
                        font_size     = int(60 * scale)
                        line_spacing  = 1.3

                        # Try to load a decent font, fall back to PIL default
                        try:
                            font = ImageFont.truetype("arial.ttf", font_size)
                        except Exception:
                            try:
                                font = ImageFont.truetype(
                                    "C:/Windows/Fonts/arial.ttf", font_size
                                )
                            except Exception:
                                font = ImageFont.load_default()

                        # ── Word-wrap ─────────────────────────────────────────────
                        def wrap_text(draw, text, font, max_width):
                            words   = text.split()
                            lines   = []
                            current = []
                            for word in words:
                                test = " ".join(current + [word])
                                bbox = draw.textbbox((0, 0), test, font=font)
                                if bbox[2] > max_width and current:
                                    lines.append(" ".join(current))
                                    current = [word]
                                else:
                                    current.append(word)
                            if current:
                                lines.append(" ".join(current))
                            return lines

                        # ── Measure total text block height ───────────────────────
                        probe_img  = Image.new("RGBA", (text_canvas_w, 100), (0, 0, 0, 0))
                        probe_draw = ImageDraw.Draw(probe_img)
                        lines      = wrap_text(probe_draw, text, font, text_canvas_w)

                        line_h     = int(font_size * line_spacing)
                        block_h    = line_h * len(lines) + 20  # +20 for stroke bleed

                        # ── Draw text onto transparent image ──────────────────────
                        img  = Image.new("RGBA", (text_canvas_w, block_h), (0, 0, 0, 0))
                        draw = ImageDraw.Draw(img)

                        for i, line in enumerate(lines):
                            bbox   = draw.textbbox((0, 0), line, font=font)
                            line_w = bbox[2] - bbox[0]
                            lx     = (text_canvas_w - line_w) // 2  # centre-align
                            ly     = i * line_h

                            # Stroke (draw offset copies in black)
                            for ox, oy in [(-2,0),(2,0),(0,-2),(0,2),(-2,-2),(2,-2),(-2,2),(2,2)]:
                                draw.text((lx + ox, ly + oy), line, font=font, fill=(0, 0, 0, 255))

                            # Fill
                            draw.text((lx, ly), line, font=font, fill=(255, 255, 255, 255))

                        # ── Convert to numpy RGBA → moviepy ImageClip ─────────────
                        arr = np.array(img)   # shape (H, W, 4)

                        tc = (
                            ImageClip(arr, ismask=False)
                            .set_duration(duration)
                            .set_start(start)
                        )

                        # Position: x/y are normalised 0..1, anchor to centre of block
                        dx = x * CANVAS_W - text_canvas_w / 2
                        dy = y * CANVAS_H - block_h / 2
                        tc = tc.set_position((int(dx), int(dy)))

                        video_layers.append(tc)
                        print(f"[render] narration OK: {len(lines)} lines at ({dx:.0f},{dy:.0f})", file=sys.stderr)

                    except Exception as exc:
                        import traceback
                        print(f"[render] ERROR: narration render failed: {exc}", file=sys.stderr)
                        print(traceback.format_exc(), file=sys.stderr)
                    continue

                fpath = _resolve(src)

                if not os.path.isfile(fpath):
                    print(
                        f"[render] WARNING: file not found, skipping — {fpath}",
                        file=sys.stderr,
                    )
                    continue

                # ------------------------------------------------------------------
                # AUDIO
                # ------------------------------------------------------------------
                if ctype == "audio":
                    try:
                        audio = AudioFileClip(fpath)
                        audio = (
                            audio
                            .subclip(0, min(duration, audio.duration))
                            .set_start(start)
                        )
                        audio_tracks.append(audio)
                    except Exception as exc:
                        print(
                            f"[render] WARNING: audio load failed ({src}): {exc}",
                            file=sys.stderr,
                        )
                    continue

                # ------------------------------------------------------------------
                # VIDEO
                # ------------------------------------------------------------------
                if ctype == "video":
                    try:
                        vc = VideoFileClip(fpath, audio=True)
                        vc = vc.subclip(0, min(duration, vc.duration))

                        natW, natH = vc.size

                        fit_scale = min(
                            CANVAS_W * 0.88 / natW,
                            CANVAS_H * 0.80 / natH,
                            1.0,
                        )

                        dw = natW * fit_scale * scale
                        dh = natH * fit_scale * scale

                        dx = x * CANVAS_W - dw / 2
                        dy = y * CANVAS_H - dh / 2

                        vc = (
                            vc
                            .resize((int(round(dw)), int(round(dh))))
                            .set_position((dx, dy))
                            .set_start(start)
                        )

                        if vc.audio is not None:
                            audio_tracks.append(vc.audio.set_start(start))
                            vc = vc.without_audio()

                        video_layers.append(vc)

                    except Exception as exc:
                        print(
                            f"[render] WARNING: video load failed ({src}): {exc}",
                            file=sys.stderr,
                        )

                    continue

                # ------------------------------------------------------------------
                # IMAGE
                # ------------------------------------------------------------------
                if ctype == "image":
                    try:
                        ic = ImageClip(fpath, duration=duration)

                        natW, natH = ic.size

                        fit_scale = min(
                            CANVAS_W * 0.88 / natW,
                            CANVAS_H * 0.80 / natH,
                            1.0,
                        )

                        dw = natW * fit_scale * scale
                        dh = natH * fit_scale * scale

                        dx = x * CANVAS_W - dw / 2
                        dy = y * CANVAS_H - dh / 2

                        ic = (
                            ic
                            .resize((int(round(dw)), int(round(dh))))
                            .set_position((dx, dy))
                            .set_start(start)
                        )

                        video_layers.append(ic)

                    except Exception as exc:
                        print(
                            f"[render] WARNING: image load failed ({src}): {exc}",
                            file=sys.stderr,
                        )

                    continue

            # ── Composite ─────────────────────────────────────────────────────────
            final_video = CompositeVideoClip(
                video_layers,
                size=(CANVAS_W, CANVAS_H),
                use_bgclip=True,     # bg clip sets total duration
            ).set_duration(DURATION)

            if audio_tracks:
                final_audio = CompositeAudioClip(audio_tracks)
                final_video = final_video.set_audio(final_audio)

            # ── Write ─────────────────────────────────────────────────────────────
            # Run the blocking write in a thread so the event loop stays live.
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: final_video.write_videofile(
                    out_path,
                    fps=FPS,
                    codec="libx264",
                    audio_codec="aac",
                    preset="slow",
                    ffmpeg_params=[
                        "-crf", "18",
                        "-profile:v", "high",
                        "-level", "4.2",
                        "-pix_fmt", "yuv420p",
                        "-b:v", "10M",
                        "-maxrate", "12M",
                        "-bufsize", "24M",
                        "-ar", "48000",
                        "-b:a", "320k",
                    ],
                    logger=None,       # suppress moviepy's tqdm spam
                )
            )

            await websocket.send_text(json.dumps({
                "type":    "render_status",
                "status":  "done",
                "message": f"Rendered → {out_path}",
                "path":    f"/media/{proj_name}_output.mp4",
            }))

        except Exception as exc:
            import traceback
            await websocket.send_text(json.dumps({
                "type":    "render_status",
                "status":  "error",
                "message": str(exc),
                "detail":  traceback.format_exc()[-800:],
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