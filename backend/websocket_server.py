import asyncio
import json

from models import Project, new_clip


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
            self.project = Project(msg.get("data", {}))

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
        FFmpeg render stub.  Replace the ffmpeg_cmd list with your
        real composition command once the frame-export pipeline exists.
        Emits render_status messages: started → progress → done | error
        """
        import subprocess, shutil, tempfile, os

        out_name = project_data.get("name", "output").replace(" ", "_")
        out_path = os.path.join(tempfile.gettempdir(), f"{out_name}.mp4")

        # Guard: FFmpeg must be on PATH
        if not shutil.which("ffmpeg"):
            await websocket.send_text(json.dumps({
                "type":    "render_status",
                "status":  "error",
                "message": "ffmpeg not found on PATH"
            }))
            return

        # ── Stub command: 5-second black 1080×1920 MP4 ──────────────────────
        # Replace this with your real frame-pipe command.
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-f",  "lavfi", "-i", f"color=black:size=1080x1920:rate=30:duration={project_data.get('duration', 5)}",
            "-f",  "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-shortest",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac",     "-b:a",    "128k",
            out_path
        ]

        try:
            proc = await asyncio.create_subprocess_exec(
                *ffmpeg_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()

            if proc.returncode == 0:
                await websocket.send_text(json.dumps({
                    "type":    "render_status",
                    "status":  "done",
                    "message": f"Rendered → {out_path}",
                    "path":    out_path,
                }))
            else:
                await websocket.send_text(json.dumps({
                    "type":    "render_status",
                    "status":  "error",
                    "message": stderr.decode()[-400:],
                }))
        except Exception as exc:
            await websocket.send_text(json.dumps({
                "type":    "render_status",
                "status":  "error",
                "message": str(exc),
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