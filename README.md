# vidkit studio

Beat-locked motion graphics, rendered offline. Every frame is a pure function of
time, so the preview and the exported video are the same renderer, and the same
project always renders the same pixels.

<video src="docs/media/showcase.mp4" controls muted loop playsinline width="100%"></video>

*([docs/media/showcase.mp4](docs/media/showcase.mp4) — the 24 s showcase, rendered from
[projects/showcase.json](projects/showcase.json) with `render.bat projects\showcase.json --preset 1080p30`.)*

## Quick start (Windows)

```cmd
python -m venv videoeditor_venv
videoeditor_venv\Scripts\activate
pip install -r requirements.txt
doctor.bat --quick
render.bat projects\showcase.json --preset 1080p30
```

`doctor.bat` checks Python, ffmpeg, Playwright Chromium, fonts, assets and the
project schema, and fetches what's missing. Copy `config.example.json` to
`config.json` for machine-specific settings (ffmpeg dir, optional local LLM).

## Rendering

```cmd
render.bat projects\showcase.json --preset 1080p60
render.bat projects\showcase.json --range 2.0-4.5 --draft
render.bat projects\showcase.json --preset vertical
```

Presets: `1080p30`, `1080p60`, `vertical`, `720p30`, `project`. Other options:
`--range`, `--draft`, `--workers N`, `--encoder nvenc` and `--no-cache`.
Outputs go to `renders/` (git-ignored).

## Other tools

```cmd
python -m studio.beatgrid projects\showcase.json    # check cuts/hits against the beat grid
python -m studio.lint_motion                        # motion lint over the renderer
python -m studio.schema migrate "projects\old.vkit" # convert an old .vkit project
python -m studio.assets_fetch --query "neon sign" --slug neon --count 3
npm test                                            # renderer unit tests
```

## Projects

Projects are JSON (`vidkit.project`, schema in `studio/schema.py`): settings, tracks,
clips with `props`, and an audio block (synthesised music and auto sound effects).
Only [projects/showcase.json](projects/showcase.json) is tracked; your own projects,
uploads, renders and reports stay local and are git-ignored.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, schema, renderer, audio, render engine
- [docs/AUDIT.md](docs/AUDIT.md) — audit of the previous version
- `legacy/` — the retired browser editor, kept for reference

Third-party photos, fonts and icons in `assets/` carry their licences in
`assets/MANIFEST.json`.
