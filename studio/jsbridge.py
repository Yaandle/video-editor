"""Python → Node bridge over the renderer's pure modules (studio/js/bridge.mjs)."""
from __future__ import annotations

import json
import shutil
import subprocess

from . import paths

BRIDGE = paths.ROOT / "studio" / "js" / "bridge.mjs"


class BridgeError(RuntimeError):
    pass


def node() -> str:
    exe = shutil.which("node")
    if not exe:
        raise BridgeError("Node.js not found on PATH (needed for renderer events and schemas).")
    return exe


def call(cmd: str, payload=None, timeout: float = 60):
    r = subprocess.run([node(), str(BRIDGE), cmd], input=json.dumps(payload) if payload is not None else "",
                       capture_output=True, text=True, timeout=timeout, cwd=str(paths.ROOT), encoding="utf-8")
    if r.returncode != 0:
        raise BridgeError(f"bridge {cmd} failed: {r.stderr.strip()[-2000:]}")
    return json.loads(r.stdout)


def events(project: dict) -> dict:
    return call("events", project)


def validate_props(project: dict) -> list[str]:
    return call("validate", project)["errors"]


def catalogue() -> list[dict]:
    return call("catalogue")


def motion_table() -> dict:
    return call("motion")
