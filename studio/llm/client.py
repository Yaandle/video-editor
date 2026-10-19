"""Optional local LLM via llama.cpp's llama-server (OpenAI-compatible HTTP).

The model only ever returns data: JSON constrained by a JSON Schema
(response_format json_schema → llama.cpp grammar), low temperature, then
validated by the caller. Nothing it returns is executed.

If the model file or llama-server is missing, status() says why and every
caller falls back to the deterministic path; the editor keeps working.
"""
from __future__ import annotations

import atexit
import json
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from .. import config, tooling

_proc: subprocess.Popen | None = None
_lock = threading.Lock()


class LLMUnavailable(RuntimeError):
    pass


def status() -> dict:
    if not config.get("llm", "enabled"):
        return {"available": False, "reason": "disabled in config.json (llm.enabled=false)", "model": None, "server": None}
    model = Path(config.get("llm", "model_path"))
    server = tooling.llama_server()
    if not model.is_file():
        return {"available": False, "reason": f"model file not found: {model}", "model": str(model), "server": server}
    if not server:
        return {"available": False, "reason": "llama-server not found (winget install ggml.llamacpp, or set llm.server_exe)", "model": str(model), "server": None}
    return {"available": True, "reason": None, "model": str(model), "server": server, "running": _healthy()}


def _base() -> str:
    return f"http://127.0.0.1:{config.get('llm', 'port')}"


def _healthy() -> bool:
    try:
        with urllib.request.urlopen(_base() + "/health", timeout=1.5) as r:
            return r.status == 200 and json.loads(r.read() or b"{}").get("status", "ok") == "ok"
    except Exception:
        return False


def ensure_server(timeout: float = 240) -> None:
    global _proc
    st = status()
    if not st["available"]:
        raise LLMUnavailable(st["reason"])
    if _healthy():
        return
    with _lock:
        if _proc is None or _proc.poll() is not None:
            cmd = [st["server"], "-m", st["model"], "--host", "127.0.0.1", "--port", str(config.get("llm", "port")),
                   "-c", str(config.get("llm", "ctx")), "-ngl", str(config.get("llm", "n_gpu_layers")), "--no-webui"]
            _proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            atexit.register(stop)
    t = time.time()
    while time.time() - t < timeout:
        if _proc.poll() is not None:
            raise LLMUnavailable(f"llama-server exited with code {_proc.returncode} while loading the model")
        if _healthy():
            return
        time.sleep(1.0)
    raise LLMUnavailable("llama-server did not become ready in time")


def stop() -> None:
    global _proc
    if _proc and _proc.poll() is None:
        _proc.terminate()
        try:
            _proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _proc.kill()
    _proc = None


SYSTEM = ("You are a data generator for a motion-design video editor. Reply with JSON only, matching the schema. "
          "Write plain, specific copy in sentence case. Never use all caps for headlines, never use emoji, never invent statistics.")


def generate_json(prompt: str, schema: dict, max_tokens: int = 1200, temperature: float | None = None, system: str = SYSTEM) -> dict:
    ensure_server()
    body = {
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        "temperature": config.get("llm", "temperature") if temperature is None else temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_schema", "json_schema": {"name": "result", "schema": schema, "strict": True}},
    }
    req = urllib.request.Request(_base() + "/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise LLMUnavailable(f"llama-server error {e.code}: {e.read()[:300]!r}") from None
    text = data["choices"][0]["message"]["content"]
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"model returned invalid JSON: {e}") from None
