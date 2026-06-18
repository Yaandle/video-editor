import asyncio
import websockets

from websocket_server import VideoEditorServer


async def main():

    server = VideoEditorServer()

    async with websockets.serve(
        server.handler,
        "localhost",
        8765
    ):
        print("Server running on ws://localhost:8765")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())