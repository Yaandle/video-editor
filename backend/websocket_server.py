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
            # Placeholder — wire render pipeline here
            await websocket.send_text(json.dumps({
                "type": "render_status",
                "status": "not_implemented"
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