import asyncio
import json
import websockets

from models import Project, new_clip


class VideoEditorServer:

    def __init__(self):
        self.project = Project()
        self.clients = set()

    async def register(self, websocket):
        self.clients.add(websocket)

        await websocket.send(
            json.dumps({
                "type": "project",
                "data": self.project.to_dict()
            })
        )

    async def unregister(self, websocket):
        self.clients.remove(websocket)

    async def broadcast(self, message):
        if not self.clients:
            return

        await asyncio.gather(
            *[
                client.send(json.dumps(message))
                for client in self.clients
            ]
        )

    async def handle_message(self, websocket, raw):

        msg = json.loads(raw)
        action = msg["action"]

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

    async def handler(self, websocket):

        await self.register(websocket)

        try:
            async for message in websocket:
                await self.handle_message(
                    websocket,
                    message
                )

        finally:
            await self.unregister(websocket)