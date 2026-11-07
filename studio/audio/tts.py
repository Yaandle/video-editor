"""Local text-to-speech with Kokoro-82M (ONNX), fully offline once the model is on disk.

Model files (git-ignored) live in models/kokoro/:
  kokoro-v1.0.onnx, voices-v1.0.bin
from https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0

    python -m studio.audio.tts "Watch where the ball lands." -o media/vo.wav --voice am_michael
    python -m studio.audio.tts --list-voices
"""
from __future__ import annotations

import argparse
from functools import lru_cache
from pathlib import Path

from .. import paths

MODEL_DIR = paths.ROOT / "models" / "kokoro"
MODEL = MODEL_DIR / "kokoro-v1.0.onnx"
VOICES = MODEL_DIR / "voices-v1.0.bin"
DEFAULT_VOICE = "bm_george"  # calm British male; Kokoro has no Australian voice
DEFAULT_SPEED = 0.95


@lru_cache(maxsize=1)
def _engine():
    if not MODEL.exists() or not VOICES.exists():
        raise FileNotFoundError(f"Kokoro model missing: put kokoro-v1.0.onnx and voices-v1.0.bin in {paths.rel(MODEL_DIR)}")
    from kokoro_onnx import Kokoro
    return Kokoro(str(MODEL), str(VOICES))


def voices() -> list[str]:
    return sorted(_engine().get_voices())


def lang_for(voice: str) -> str:
    return "en-gb" if voice[:1] == "b" else "en-us"


def synth(text: str, out: Path, voice: str = DEFAULT_VOICE, speed: float = DEFAULT_SPEED) -> float:
    """Speak `text` into a WAV at `out`; returns its length in seconds."""
    import soundfile as sf
    text = " ".join(text.split())
    if not text:
        raise ValueError("no text to speak")
    samples, sr = _engine().create(text, voice=voice, speed=speed, lang=lang_for(voice))
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out), samples, sr)
    return len(samples) / sr


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m studio.audio.tts", description="local Kokoro text-to-speech")
    ap.add_argument("text", nargs="?")
    ap.add_argument("-o", "--out", default="media/tts.wav")
    ap.add_argument("--voice", default=DEFAULT_VOICE)
    ap.add_argument("--speed", type=float, default=DEFAULT_SPEED)
    ap.add_argument("--list-voices", action="store_true")
    a = ap.parse_args(argv)
    if a.list_voices:
        print(" ".join(voices()))
        return 0
    if not a.text:
        ap.error("text is required")
    secs = synth(a.text, Path(a.out), a.voice, a.speed)
    print(f"wrote {a.out} ({secs:.2f} s, {a.voice})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
