import json
import math
import os

from text_anim import Easing

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "easing_golden.json")


def _load_cases():
    with open(FIXTURE_PATH, "r", encoding="utf8") as f:
        return json.load(f)["cases"]


def test_text_anim_easing_matches_golden_values():
    """text_anim.Easing must match the documented canonical formulas â€” the
    same golden table frontend/tests/easing_parity.test.mjs checks canvas.js's
    Easing against, so both are proven consistent with one source of truth
    rather than with each other directly."""
    fn_map = {
        "linear": Easing.linear,
        "easeOutCubic": Easing.ease_out_cubic,
        "easeOutExpo": Easing.ease_out_expo,
    }
    for case in _load_cases():
        fn_name, t, expected = case["fn"], case["t"], case["expected"]
        if fn_name == "easeOutBack":
            actual = Easing.ease_out_back(t, case["overshoot"])
        else:
            actual = fn_map[fn_name](t)
        assert math.isclose(actual, expected, abs_tol=1e-9), (
            f"{fn_name}(t={t}) = {actual}, expected {expected}"
        )

