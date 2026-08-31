import os
import subprocess
import sys
import tempfile

import pytest

# backend/*.py (main.py, websocket_server.py, models.py, ...) is a flat module
# layout meant to be run as `python backend/main.py`, not an installed
# package â€” put backend/ on sys.path so tests can `import main` etc. the same
# way the app itself resolves its own sibling imports.
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import imageio_ffmpeg  # noqa: E402

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

# Cached outside the repo (OS temp dir) so the large synthetic fixture is
# never committed and never regenerated across runs once it exists.
_FIXTURE_DIR = os.path.join(tempfile.gettempdir(), "vidkit_test_fixtures")
os.makedirs(_FIXTURE_DIR, exist_ok=True)

# The "large/full-length video" baseline for this task: 20 minutes, 1080p,
# H.264 â€” far past the old implicit in-memory-buffer failure point and
# clearly representative of a full-length export source, while keeping
# one-time generation and test I/O reasonable.
BIG_VIDEO_DURATION_S = 20 * 60
BIG_VIDEO_PATH = os.path.join(_FIXTURE_DIR, "big_synthetic_1080p_20min.mp4")


@pytest.fixture(scope="session")
def big_video_path():
    """Session-scoped, disk-cached synthetic large video used by the
    large-file-load and long-form render tests."""
    if not os.path.isfile(FFMPEG):
        pytest.skip("ffmpeg not available")
    if not os.path.isfile(BIG_VIDEO_PATH) or os.path.getsize(BIG_VIDEO_PATH) < 50_000_000:
        cmd = [
            FFMPEG, "-y",
            "-f", "lavfi", "-i", f"testsrc=size=1920x1080:rate=30:duration={BIG_VIDEO_DURATION_S}",
            "-f", "lavfi", "-i", f"sine=frequency=440:duration={BIG_VIDEO_DURATION_S}",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest",
            BIG_VIDEO_PATH,
        ]
        subprocess.run(cmd, check=True, capture_output=True)
    return BIG_VIDEO_PATH


@pytest.fixture(scope="session")
def small_image_path(tmp_path_factory):
    from PIL import Image
    d = tmp_path_factory.mktemp("assets")
    p = d / "small.png"
    Image.new("RGB", (320, 240), (80, 140, 200)).save(p)
    return str(p)


@pytest.fixture(scope="session")
def sfx_paths():
    """Reuses the app's own committed/generated SFX wavs (backend/sfx) as
    small, already-available audio fixtures instead of inventing new ones."""
    sfx_dir = os.path.join(BACKEND_DIR, "sfx")
    from sfx_gen import ensure_sfx_pack
    ensure_sfx_pack(sfx_dir)
    return sorted(
        os.path.join(sfx_dir, f) for f in os.listdir(sfx_dir) if f.endswith(".wav")
    )

