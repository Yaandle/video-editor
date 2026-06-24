from dataclasses import dataclass, field, asdict
from pathlib import Path
import uuid

CLIP_TYPE_TRACK = {
    "narration": "text",
    "code":      "visual",
    "graph":     "visual",
    "audio":     "audio",
    "image":     "visual",  
    "video":     "visual",  
}


@dataclass
class Clip:
    id: str
    track: str
    clip_type: str
    start: float
    duration: float

    content: str = ""

    x: float = 0.5
    y: float = 0.15
    scale: float = 1.0  
    
    animation: str = "typewriter"
    theme: str = "dark"

    code_file: str = ""

    graph_type: str = "bar"
    graph_data: str = ""

    voice_id: str = ""

    def end(self):
        return self.start + self.duration

    def label(self):
        if self.clip_type == "narration":
            preview = self.content[:28].replace("\n", " ")
            return f'"{preview}..."'

        if self.clip_type == "code":
            return f"code · {Path(self.code_file).name}"

        if self.clip_type == "graph":
            return f"graph · {self.graph_type}"

        return self.clip_type


@dataclass
class Project:
    name: str = "untitled"
    canvas_w: int = 1080
    canvas_h: int = 1920
    fps: int = 30
    duration: float = 30.0
    clips: list = field(default_factory=list)

    def to_dict(self):
        return {
            "name": self.name,
            "canvas_w": self.canvas_w,
            "canvas_h": self.canvas_h,
            "fps": self.fps,
            "duration": self.duration,
            "clips": [asdict(c) for c in self.clips],
        }

    @staticmethod
    def from_dict(data):
        project = Project(
            name=data.get("name", "untitled"),
            canvas_w=data.get("canvas_w", 1080),
            canvas_h=data.get("canvas_h", 1920),
            fps=data.get("fps", 30),
            duration=data.get("duration", 30.0),
        )

        for clip_data in data.get("clips", []):
            project.clips.append(Clip(**clip_data))

        return project


def new_clip(clip_type, start=0.0, duration=5.0):
    track = CLIP_TYPE_TRACK.get(clip_type, "visual")

    return Clip(
        id=str(uuid.uuid4())[:8],
        track=track,
        clip_type=clip_type,
        start=start,
        duration=duration,
    )