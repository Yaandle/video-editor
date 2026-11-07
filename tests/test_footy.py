"""Footy breakdown: the moments-file honesty rules, the approval gate and the placeholder's frame barcode.

The timing logic (freezes land on the exact frame, keyframes interpolate) is tested in
frontend/tests/breakdown.test.mjs, against the module the renderer runs.
"""
import copy
import json
from pathlib import Path

import pytest

from studio.footy import moments as M
from studio.footy import placeholder

EXAMPLE = Path(__file__).resolve().parent.parent / "docs" / "footy" / "placeholder.moments.json"


@pytest.fixture()
def data():
    return json.loads(EXAMPLE.read_text(encoding="utf-8"))


def test_example_passes_check(data):
    errors, warns, mf = M.check(data)
    assert errors == []
    assert [m.id for m in mf.moments if m.status == "keep"] == ["m1", "m2"]
    # the ADJUST flags reach the reviewer
    assert any("ADJUST" in w for w in warns)


def test_unsure_claim_never_goes_on_screen(data):
    m = data["moments"][0]
    m["captions"]["freeze"][0]["claims"] = ["a7"]          # a7 is 'unsure'
    errors, _, _ = M.check(data)
    assert any("unsure claim a7" in e for e in errors)


def test_unsure_claim_never_drawn(data):
    data["moments"][0]["annotations"][0]["claims"] = ["a7"]
    errors, _, _ = M.check(data)
    assert any("illustrates unsure claim a7" in e for e in errors)


def test_caption_needs_a_claim(data):
    data["moments"][0]["captions"]["freeze"][1]["claims"] = []
    errors, _, _ = M.check(data)
    assert any("without a claim behind it" in e for e in errors)


def test_moment_must_say_what_it_cannot_tell(data):
    data["moments"][1]["cannot_tell"] = []
    errors, _, _ = M.check(data)
    assert any("cannot_tell is empty" in e for e in errors)


def test_dropped_moment_needs_a_reason(data):
    data["moments"][1]["status"] = "drop"
    data["moments"][1]["drop_reason"] = ""
    errors, _, _ = M.check(data)
    assert any("drop_reason" in e for e in errors)


def test_real_clip_must_log_its_source(data):
    c = data["clips"][0]
    c["placeholder"] = False
    c["source"].update(kind="file", rights="unchecked", url=None, file=None, date=None)
    errors, warns, _ = M.check(data)
    assert any("log where it came from" in e for e in errors)
    assert any("match date" in e for e in errors)
    assert any("rights unchecked" in w for w in warns)


def test_names_scores_and_hype_are_flagged(data):
    data["moments"][0]["captions"]["freeze"][0]["text"] = "Smith kicks it, 10.4 (64) up!"
    _, warns, _ = M.check(data)
    text = " ".join(warns)
    assert "may be a name" in text and "looks like a score" in text and "hype" in text


def test_approval_gate(tmp_path, data):
    p = tmp_path / "moments.json"
    data["review"] = {"status": "proposed", "by": None, "at": None, "hash": None, "notes": ""}
    M.save(p, data)
    with pytest.raises(PermissionError):
        M.require_approved(M.load(p))
    M.approve(p, "tester")
    M.require_approved(M.load(p))                          # approved and unchanged: passes
    edited = M.load(p)
    edited["moments"][0]["captions"]["outcome"]["text"] = "Something else."
    with pytest.raises(PermissionError, match="changed after approval"):
        M.require_approved(edited)


def test_approval_refused_while_errors(tmp_path, data):
    bad = copy.deepcopy(data)
    bad["moments"][0]["claims"] = []
    p = tmp_path / "moments.json"
    M.save(p, bad)
    with pytest.raises(ValueError, match="cannot approve"):
        M.approve(p, "tester")


def test_placeholder_barcode_round_trip():
    state = {}
    for f in range(0, 60):
        img = placeholder.frame_image(f, state)
        assert placeholder.barcode(img) == f
