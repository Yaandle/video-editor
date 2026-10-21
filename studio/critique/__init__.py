"""Quality gate: automated frame pass, per-pack checks, review stills, contact
sheets and the 10-point rubric.

    critique.bat renders/x/x_1080p30.mp4 [--review review.json]
    python -m studio.critique renders/x/x_1080p30.mp4

Writes reports/critique_<render>.json and reports/critique_<render>/ (contact
sheets, full-size stills). See rubric.py for the scoring.
"""
