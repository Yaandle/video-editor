"""Read an Aussie Rules 2 `.replay` file: the per-frame match state the game recorded.

Layout (the game's scripts/highlights/replay_clip.gd, VERSION 1): `store_var(meta)`,
which writes a u32 byte length then the Variant, then for each frame `store_32(size)`
and `size` bytes. Every frame starts with

    clock f32 (seconds left in the quarter), quarter u8,
    home goals u8, home behinds u8, away goals u8, away behinds u8,
    ball position 3 x f32 (metres, Godot axes: y is up)

and then the bodies, which this reader skips. Only the fixed-offset header is read, so
the Godot Variant meta never has to be decoded.

The ball track is what makes the cut frame-exact: the kick is the last jump in ball
speed before the event, and after a goal the ball keeps flying past the posts, where
the replay camera follows it into the trees. `leaves_f` marks the frame it gets there.
"""
from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from pathlib import Path

HEAD = struct.Struct("<fBBBBBfff")   # clock, quarter, hg, hb, ag, ab, ball x, y, z


@dataclass
class Track:
    fps: float
    clock: list[float]
    quarter: list[int]
    score: list[tuple[int, int, int, int]]   # home goals, home behinds, away goals, away behinds
    ball: list[tuple[float, float, float]]

    @property
    def frames(self) -> int:
        return len(self.ball)

    def speed(self, f: int) -> float:
        """Ball speed in m/s arriving at frame f."""
        if f <= 0 or f >= self.frames:
            return 0.0
        return math.dist(self.ball[f], self.ball[f - 1]) * self.fps

    def score_change(self, near: int, window: int = 30) -> int | None:
        """The first frame within `window` of `near` where the score differs from the frame before."""
        lo, hi = max(1, near - window), min(self.frames, near + window + 1)
        for f in range(lo, hi):
            if self.score[f] != self.score[f - 1]:
                return f
        return None

    def speed3(self, f: int) -> float:
        """Ball speed over the 3 frames ending at f. The game steps physics at 60 Hz and records
        at 30 fps, so frame-to-frame displacement runs in a 1/3, 2/3, 1 cycle; three frames
        cover one whole cycle and read steady."""
        if f < 3 or f >= self.frames:
            return 0.0
        return math.dist(self.ball[f], self.ball[f - 3]) * self.fps / 3

    def kick_before(self, event_f: int, fast: float = 15.0, slow: float = 10.0) -> int | None:
        """The last kick before event_f: the 3-frame speed goes from under `slow` to over `fast`.
        Returns the frame the boot meets the ball (±1)."""
        for f in range(min(event_f, self.frames - 1) - 1, 5, -1):
            if self.speed3(f) >= fast and self.speed3(f - 3) < slow:
                # the jump is inside (f-3, f]: take the first frame there moving faster than `fast`
                for g in range(f - 2, f + 1):
                    if self.speed(g) >= fast:
                        return g - 1
                return f - 2
        return None

    def teleports(self, lo: int = 1, hi: int | None = None) -> list[int]:
        """Frames where the ball jumps more than 8 m in one frame: a reset (centre bounce, a free
        kick placed somewhere). The replay camera snaps there too, so a cut must not span one."""
        hi = self.frames if hi is None else min(hi, self.frames)
        return [f for f in range(max(1, lo), hi) if math.dist(self.ball[f], self.ball[f - 1]) > 8.0]

    def ground_dist(self, a: int, b: int) -> float:
        """Horizontal distance (x, z) between the ball at frames a and b, in metres."""
        (x0, _y0, z0), (x1, _y1, z1) = self.ball[a], self.ball[b]
        return math.hypot(x1 - x0, z1 - z0)

    def reset_after(self, event_f: int) -> int | None:
        """The frame the ball teleports (centre-bounce reset) after event_f: an impossible jump."""
        for f in range(max(1, event_f), self.frames):
            if math.dist(self.ball[f], self.ball[f - 1]) > 8.0:
                return f
        return None

    def leaves_after(self, event_f: int, margin_m: float = 5.0) -> int | None:
        """After a goal or behind: the frame the ball is `margin_m` past where it crossed the line
        (along the ground's long axis, x). The replay camera follows the ball, so past here it
        heads off the ground and into the trees."""
        if not (0 <= event_f < self.frames):
            return None
        x0 = self.ball[event_f][0]
        side = 1.0 if x0 >= 0 else -1.0
        stop = self.reset_after(event_f) or self.frames
        for f in range(event_f, stop):
            if (self.ball[f][0] - x0) * side > margin_m:
                return f
        return stop if stop < self.frames else None


def read(path: Path, fps: float = 30.0) -> Track:
    b = Path(path).read_bytes()
    if len(b) < 8:
        raise ValueError(f"{path.name}: too short to be a replay")
    meta_len = struct.unpack_from("<I", b, 0)[0]
    pos = 4 + meta_len
    clock, quarter, score, ball = [], [], [], []
    while pos + 4 <= len(b):
        size = struct.unpack_from("<I", b, pos)[0]
        pos += 4
        if size < HEAD.size or pos + size > len(b):
            raise ValueError(f"{path.name}: frame {len(ball)} is truncated (size {size} at byte {pos})")
        c, q, hg, hb, ag, ab, x, y, z = HEAD.unpack_from(b, pos)
        pos += size
        clock.append(round(c, 3))
        quarter.append(q)
        score.append((hg, hb, ag, ab))
        ball.append((x, y, z))
    if not ball:
        raise ValueError(f"{path.name}: no frames")
    return Track(fps=fps, clock=clock, quarter=quarter, score=score, ball=ball)
