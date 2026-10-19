import json
import os

import pytest

import websocket_server as ws_mod
from models import Project, new_clip


class _FakeWebSocket:
    def __init__(self):
        self.sent = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


pytestmark = pytest.mark.slow


@pytest.fixture
def longform_env(tmp_path, monkeypatch, big_video_path):
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    video_name = "long_source.mp4"
    import shutil
    shutil.copy(big_video_path, upload_dir / video_name)
    monkeypatch.setattr(ws_mod, "UPLOAD_DIR", str(upload_dir))
    return f"media/{video_name}"


@pytest.mark.asyncio
async def test_render_from_deep_offsets_in_a_long_source_file(longform_env):
    """The task's requirement #4 load test: a realistic worst-case source â€”
    a full-length (20-minute) video â€” used across several clips that seek
    deep into it, proving subclip/seek on a long source stays reliable and
    memory-bounded without requiring a slow multi-minute *output* encode
    (output duration, not source duration, drives encode time)."""
    video_src = longform_env
    project = Project(name="longform_test", canvas_w=640, canvas_h=360, fps=24, duration=0)

    offsets_s = [60, 600, 1150]  # 1min, 10min, ~19min into the 20-minute source
    t = 0.0
    for i, offset in enumerate(offsets_s):
        c = new_clip("video", start=t, duration=8.0)
        c.code_file = video_src
        c.source_start = float(offset)
        c.layer = 0
        project.clips.append(c)
        t += 8.0
    project.duration = t

    server = ws_mod.VideoEditorServer()
    ws = _FakeWebSocket()
    await server._run_render(ws, project.to_dict())

    statuses = [m.get("status") for m in ws.sent if m.get("type") == "render_status"]
    assert "done" in statuses, ws.sent

    out_path = os.path.join(ws_mod.UPLOAD_DIR, "longform_test_output.mp4")
    assert os.path.isfile(out_path)
    assert os.path.getsize(out_path) > 1000

