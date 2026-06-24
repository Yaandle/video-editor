import asyncio
import json

import os
import sys

from models import Project, new_clip

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR   = os.path.join(_BACKEND_DIR, "uploads")

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
        FPS       = project_data.get("fps",        30)
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
            bg = ColorClip(size=(CANVAS_W, CANVAS_H), color=(0, 0, 0), duration=DURATION)
            video_layers.append(bg)

            # ── Process clips ─────────────────────────────────────────────────────
            for clip in project_data.get("clips", []):
                ctype    = clip.get("clip_type", "")
                src      = clip.get("code_file") or clip.get("src") or ""
                start    = float(clip.get("start",    0))
                duration = float(clip.get("duration", 5))
                x        = int(clip.get("x",          0))
                y        = int(clip.get("y",           0))
                scale    = float(clip.get("scale",     1.0))

                # ── Skip unsupported types ────────────────────────────────────────
                if ctype in ("narration", "code", "graph") or not src:
                    continue

                fpath = _resolve(src)

                if not os.path.isfile(fpath):
                    # Non-fatal — log and skip missing files
                    print(f"[render] WARNING: file not found, skipping — {fpath}",
                        file=sys.stderr)
                    continue

                # ── Audio clips ───────────────────────────────────────────────────
                if ctype == "audio":
                    try:
                        aclip = (
                            AudioFileClip(fpath)
                            .subclip(0, min(duration, AudioFileClip(fpath).duration))
                            .set_start(start)
                        )
                        audio_tracks.append(aclip)
                    except Exception as exc:
                        print(f"[render] WARNING: audio load failed ({src}): {exc}",
                            file=sys.stderr)
                    continue

                # ── Video clips ───────────────────────────────────────────────────
                if ctype == "video":
                    try:
                        vc = VideoFileClip(fpath, audio=True)
                        # Trim to requested duration (don't exceed source length)
                        vc = vc.subclip(0, min(duration, vc.duration))

                        if scale != 1.0:
                            vc = vc.resize(scale)

                        vc = vc.set_position((x, y)).set_start(start)

                        # Carry embedded audio as a separate track
                        if vc.audio is not None:
                            audio_tracks.append(vc.audio.set_start(start))
                            vc = vc.without_audio()

                        video_layers.append(vc)
                    except Exception as exc:
                        print(f"[render] WARNING: video load failed ({src}): {exc}",
                            file=sys.stderr)
                    continue

                # ── Image clips ───────────────────────────────────────────────────
                if ctype == "image":
                    try:
                        ic = ImageClip(fpath, duration=duration)

                        if scale != 1.0:
                            ic = ic.resize(scale)

                        ic = ic.set_position((x, y)).set_start(start)
                        video_layers.append(ic)
                    except Exception as exc:
                        print(f"[render] WARNING: image load failed ({src}): {exc}",
                            file=sys.stderr)
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
                    preset="fast",
                    ffmpeg_params=["-crf", "23"],
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