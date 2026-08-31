import asyncio
import json
import os
import shutil
import time

import pytest

import websocket_server as ws_mod
from models import Project, new_clip


class _FakeWebSocket:
    """Stand-in for the real websocket â€” _run_render only ever calls
    send_text on it, so a small recorder is enough to drive it directly."""

    def __init__(self):
        self.sent = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


@pytest.fixture
def render_env(tmp_path, monkeypatch, small_image_path, sfx_paths, big_video_path):
    """Points the render pipeline's UPLOAD_DIR/SFX_DIR at a scratch dir seeded
    with small synthetic/reused assets, so the heavy project below never
    touches the real backend/uploads or backend/sfx."""
    upload_dir = tmp_path / "uploads"
    sfx_dir = tmp_path / "sfx"
    upload_dir.mkdir()
    sfx_dir.mkdir()

    video_name = "source.mp4"
    shutil.copy(big_video_path, upload_dir / video_name)

    image_name = "small.png"
    shutil.copy(small_image_path, upload_dir / image_name)

    sfx_names = []
    for i, p in enumerate(sfx_paths[:3]):
        name = f"sfx{i}.wav"
        shutil.copy(p, sfx_dir / name)
        sfx_names.append(name)

    monkeypatch.setattr(ws_mod, "UPLOAD_DIR", str(upload_dir))
    monkeypatch.setattr(ws_mod, "SFX_DIR", str(sfx_dir))

    return {
        "video": f"media/{video_name}",
        "image": f"media/{image_name}",
        "sfx": [f"sfx/{n}" for n in sfx_names],
    }


def _build_heavy_project(env, n_clips=100, n_layers=5):
    """A synthetic multi-asset-type, multi-layer, overlapping-clip project â€”
    the "heavy asset count" stress case named in the task."""
    project = Project(name="heavy_test", canvas_w=640, canvas_h=360, fps=24, duration=0)
    t = 0.0
    kinds = ["video", "image", "audio", "shape", "narration"]
    for i in range(n_clips):
        kind = kinds[i % len(kinds)]
        dur = 2.5
        c = new_clip(kind, start=t, duration=dur)
        if kind == "video":
            c.code_file = env["video"]
            c.source_start = float((i * 3) % 300)
        elif kind == "image":
            c.code_file = env["image"]
        elif kind == "audio":
            c.code_file = env["sfx"][i % len(env["sfx"])]
        elif kind == "shape":
            c.shape_kind = ["rectangle", "circle", "star"][i % 3]
        elif kind == "narration":
            c.content = f"Clip {i}"
            c.text_anim_style = ["typewriter", "fade", "slideup", None][i % 4]
        c.layer = i % n_layers
        project.clips.append(c)
        t += dur * 0.6  # overlap successive clips across layers
    project.duration = t + 3
    return project


@pytest.mark.asyncio
async def test_heavy_project_renders_without_blocking_event_loop(render_env):
    server = ws_mod.VideoEditorServer()
    project = _build_heavy_project(render_env)
    project_data = project.to_dict()
    ws = _FakeWebSocket()

    # The regression check for the compose-stage event-loop-blocking fix:
    # before it, the whole compose loop ran synchronously on the loop and
    # this ticker would stall for the entire compose duration instead of
    # ticking every ~50ms.
    ticks = []
    stop = False

    async def ticker():
        while not stop:
            ticks.append(time.monotonic())
            await asyncio.sleep(0.05)

    ticker_task = asyncio.create_task(ticker())
    try:
        await server._run_render(ws, project_data)
    finally:
        stop = True
        await ticker_task

    statuses = [m.get("status") for m in ws.sent if m.get("type") == "render_status"]
    assert "done" in statuses, ws.sent

    gaps = [b - a for a, b in zip(ticks, ticks[1:])]
    assert max(gaps, default=0) < 1.0, (
        f"event loop stalled for {max(gaps, default=0):.2f}s during render â€” "
        f"compose is likely running synchronously on the event loop again"
    )

    out_path = os.path.join(ws_mod.UPLOAD_DIR, "heavy_test_output.mp4")
    assert os.path.isfile(out_path)
    assert os.path.getsize(out_path) > 1000


@pytest.mark.asyncio
async def test_concurrent_renders_are_serialized(render_env):
    """Two renders fired at once should run one-at-a-time (the semaphore
    guard), not compete for memory simultaneously."""
    server = ws_mod.VideoEditorServer()
    project = _build_heavy_project(render_env, n_clips=20, n_layers=3)
    project.name = "concurrent_a"
    data_a = project.to_dict()
    project.name = "concurrent_b"
    data_b = project.to_dict()

    active = {"count": 0, "max": 0}
    orig_semaphore = server._render_semaphore

    class _TrackingSemaphore:
        async def __aenter__(self):
            await orig_semaphore.acquire()
            active["count"] += 1
            active["max"] = max(active["max"], active["count"])
            return self

        async def __aexit__(self, *exc):
            active["count"] -= 1
            orig_semaphore.release()

    server._render_semaphore = _TrackingSemaphore()

    ws_a, ws_b = _FakeWebSocket(), _FakeWebSocket()
    await asyncio.gather(
        server._run_render(ws_a, data_a),
        server._run_render(ws_b, data_b),
    )

    assert active["max"] == 1, "more than one render ran concurrently despite the semaphore guard"
    for ws in (ws_a, ws_b):
        statuses = [m.get("status") for m in ws.sent if m.get("type") == "render_status"]
        assert "done" in statuses, ws.sent

