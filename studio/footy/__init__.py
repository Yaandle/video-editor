"""Footy breakdown pipeline: match clip → candidate moments → reviewed analysis → coach-style video.

    python -m studio.footy placeholder            make the labelled synthetic test clip
    python -m studio.footy ingest  <file> ...      trim + proxy a supplied clip, log its source
    python -m studio.footy scan    <moments.json>  cheap signals → ranked candidates + contact sheets
    python -m studio.footy frames  <moments.json>  full frames with a video-px grid (for placing marks)
    python -m studio.footy check   <moments.json>  validate the analysis, write the review summary
    python -m studio.footy approve <moments.json>  record approval (the render gate)
    python -m studio.footy build   <moments.json>  approved moments → projects/afl-breakdown.json
    python -m studio.footy verify  <render.mp4>    freezes landed on the exact frames

See docs/FOOTY_BREAKDOWN.md. Nothing here downloads footage.
"""
