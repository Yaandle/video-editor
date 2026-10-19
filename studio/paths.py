"""Every filesystem location the studio uses, derived from this file's position.

No hardcoded separators or drive letters: everything is a pathlib.Path under ROOT.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FRONTEND = ROOT / "frontend"
RENDERER = FRONTEND / "renderer"
DESIGN = ROOT / "design"
TOKENS = DESIGN / "tokens.json"
PACKS = DESIGN / "packs"
ASSETS = ROOT / "assets"
FONTS = ASSETS / "fonts"
ICONS = ASSETS / "icons"
IMAGES = ASSETS / "images"
MANIFEST = ASSETS / "MANIFEST.json"
PROJECTS = ROOT / "projects"
AUTOSAVE = PROJECTS / "autosave"
MEDIA = ROOT / "media"
UPLOADS = MEDIA / "uploads"
RENDERS = ROOT / "renders"
CACHE = RENDERS / ".cache"
REPORTS = ROOT / "reports"
TOOLS = ROOT / "tools"
LEGACY = ROOT / "legacy"
CONFIG_FILE = ROOT / "config.json"

REQUIRED_DIRS = (PROJECTS, AUTOSAVE, UPLOADS, RENDERS, CACHE, REPORTS, FONTS, ICONS, IMAGES)


def ensure_dirs() -> None:
    for d in REQUIRED_DIRS:
        d.mkdir(parents=True, exist_ok=True)


def rel(p: Path) -> str:
    """Project-relative POSIX path for logs and manifests."""
    try:
        return Path(p).resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(p)
