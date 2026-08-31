import asyncio
import os
import time
import tracemalloc

import pytest
from starlette.datastructures import UploadFile
from starlette.testclient import TestClient

import main as main_mod


@pytest.fixture
def isolated_main_env(monkeypatch, tmp_path):
    """Point main.py's upload dir + metadata cache at a scratch dir so tests
    never touch the real backend/uploads or its metadata cache file."""
    monkeypatch.setattr(main_mod, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(main_mod, "_METADATA_CACHE_PATH", str(tmp_path / ".metadata_cache.json"))
    monkeypatch.setattr(main_mod, "_metadata_cache", {})
    return tmp_path


async def _direct_upload(path, filename):
    """Call the /upload route function directly against a real on-disk file,
    bypassing HTTP/httpx entirely so memory measurements reflect only the
    handler's own behavior, not any client-side buffering."""
    f = open(path, "rb")
    try:
        uf = UploadFile(file=f, filename=filename, size=os.path.getsize(path))
        return await main_mod.upload(file=uf)
    finally:
        f.close()


def test_upload_small_file_roundtrip(isolated_main_env):
    client = TestClient(main_mod.app)
    data = os.urandom(64 * 1024)
    resp = client.post("/upload", files={"file": ("clip.bin", data, "application/octet-stream")})
    assert resp.status_code == 200
    body = resp.json()
    assert body["size"] == len(data)
    written = (isolated_main_env / body["name"]).read_bytes()
    assert written == data


@pytest.mark.asyncio
async def test_upload_large_file_streams_instead_of_buffering(isolated_main_env, big_video_path):
    """Regression test for the fix in main.py's /upload handler: it used to
    do `content = await file.read()` (whole file into one bytes object) then
    a blocking `f.write(content)`. Streamed in chunks, handler-side peak
    memory should stay near one chunk, not near the file size."""
    size_on_disk = os.path.getsize(big_video_path)

    tracemalloc.start()
    body = await _direct_upload(big_video_path, "big.mp4")
    _current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    assert body["size"] == size_on_disk
    written_path = isolated_main_env / body["name"]
    assert written_path.stat().st_size == size_on_disk

    assert peak < size_on_disk * 0.5, (
        f"peak traced memory ({peak} bytes) was not far below the file size "
        f"({size_on_disk} bytes) â€” the handler may be buffering the whole file again"
    )


@pytest.mark.asyncio
async def test_upload_probe_timeout_does_not_hang_request(isolated_main_env, tmp_path, monkeypatch):
    """A hung ffmpeg probe (pathological/corrupt file) must not hang the
    upload response forever â€” it should return promptly with empty metadata."""
    monkeypatch.setattr(main_mod, "_PROBE_TIMEOUT_S", 0.2)

    def _hanging_probe(*_a, **_kw):
        time.sleep(5)
        return {"duration": 1.0}

    monkeypatch.setattr(main_mod, "_probe_metadata_cached", _hanging_probe)

    small = tmp_path / "small.mp4"
    small.write_bytes(os.urandom(1024))

    start = time.monotonic()
    body = await _direct_upload(str(small), "small.mp4")
    elapsed = time.monotonic() - start

    assert elapsed < 2.0, f"upload took {elapsed:.2f}s â€” probe timeout did not bound the request"
    assert "metadata" not in body or not body["metadata"]

