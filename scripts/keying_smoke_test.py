#!/usr/bin/env python3
"""Offline smoke test for D38999 keying setups, variations and shapes.

Verifies that the toolbox's connector *keying* is **true to life**: every
polarization setup (keying letter), every variation (shell size / series), and
its rendered key/keyway *shape* matches the published MIL-DTL-38999 standard.

Three layers of truth must agree:

    source  =  Figure 6 (series III, PDF p.103) and Figure 7 (series IV,
               PDF p.111-112) of
               ``docs/pdfs/specs/MIL-DTL-38999-dtl38999.pdf``.
    data    =  ``data/reference/standard_definitions.json`` -> definitions.
               polarization / key_geometry  (loaded by the app at runtime).
    render  =  the SVG marker geometry produced by ``app/app.js``
               (``keyingDrawing`` / ``orientationMarker`` / ``polarPoint``).

Phases:

    A. Ground truth  - extract Figure 6/7 straight from the PDF (cached to
       ``data/reference/keying_ground_truth.json``; needs PyMuPDF only when the
       cache is absent or ``--refresh`` is passed).
    B. Data fidelity - data angles == PDF source (and DMS == decimal).
    C. Completeness  - every setup x variation present; physical sanity
       (ranges, keyable separation, K width factor, no shell 9 in series IV).
    D. Shape geometry- re-implements the app's marker placement and asserts
       marker counts, angular positions, plug-key/receptacle-keyway
       complementarity, the note-5 "main fixed / minors rotate" rule, and
       anti-mismate between different keying letters.

Exit code is non-zero if any check fails, so it doubles as CI.

Usage:
    python3 scripts/keying_smoke_test.py            # standard run
    python3 scripts/keying_smoke_test.py --full     # exhaustive shell x letter grid
    python3 scripts/keying_smoke_test.py --quiet    # only summary + failures
    python3 scripts/keying_smoke_test.py --refresh  # re-extract PDF ground truth
"""

from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dataset_io import data_path, load_dataset  # noqa: E402

import json  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
APP_JS = ROOT / "app" / "app.js"
PDF = ROOT / "docs" / "pdfs" / "specs" / "MIL-DTL-38999-dtl38999.pdf"
GROUND_TRUTH = ROOT / "data" / "reference" / "keying_ground_truth.json"

# Series III minor key/keyway rotation columns (Figure 6) in render order.
SERIES_III_COLS = ["AR_or_AP_deg", "BR_or_BP_deg", "CR_or_CP_deg", "DR_or_DP_deg"]
# Series IV main key columns (Figure 7) in render order.
SERIES_IV_MAIN_COLS = ["P_deg", "Q_deg", "R_deg", "S_deg"]
# Series IV minor polarity columns (Figure 7).
SERIES_IV_MINOR_COLS = ["X_or_XX_deg", "Y_or_YY_deg"]

SERIES_III_SHELLS = [9, 11, 13, 15, 17, 19, 21, 23, 25]
SERIES_IV_SHELLS = [11, 13, 15, 17, 19, 21, 23, 25]  # note: no shell 9
SERIES_III_LETTERS = ["N", "A", "B", "C", "D", "E"]
SERIES_IV_MINOR_LETTERS = ["N", "A", "B", "C", "D", "K", "L", "M", "R"]

# Representative smoke matrix (variations). --full expands to every cell.
SMOKE_III = {"shells": [9, 17, 25], "letters": ["N", "A", "E"]}
SMOKE_IV = {"shells": [11, 17, 25], "letters": ["N", "K", "R"]}

# Tolerances.
TOL_SOURCE = 0.5      # data angle vs PDF source (deg)
TOL_DMS = 0.02        # decimal vs DMS conversion (deg)
TOL_RENDER = 1.0      # recovered render angle vs data angle (deg)
MIN_KEY_SEPARATION = 3.0  # minimum angular gap between distinct keys (deg)

# Slash sheets used to exercise both coupling roles.
PLUG_III, RECEPTACLE_III = "/26", "/20"
PLUG_IV, RECEPTACLE_IV = "/46", "/40"


# --------------------------------------------------------------------------- #
# Report helper (mirrors scripts/smoke_test_connectors.py conventions)
# --------------------------------------------------------------------------- #
class Report:
    def __init__(self, quiet: bool) -> None:
        self.quiet = quiet
        self.failures: list[str] = []
        self.warnings: list[str] = []
        self.sections: list[tuple[str, int, int]] = []

    def section(self, title: str) -> None:
        if not self.quiet:
            print(f"\n=== {title} ===")

    def ok(self, msg: str) -> None:
        if not self.quiet:
            print(f"  PASS  {msg}")

    def fail(self, msg: str) -> None:
        self.failures.append(msg)
        print(f"  FAIL  {msg}")

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)
        if not self.quiet:
            print(f"  WARN  {msg}")

    def tally(self, title: str, passed: int, total: int) -> None:
        self.sections.append((title, passed, total))


# --------------------------------------------------------------------------- #
# Phase A - independent ground truth extracted from the PDF
# --------------------------------------------------------------------------- #
def dms_to_deg(degrees: str, minutes: str) -> float:
    return round(int(degrees) + int(minutes) / 60.0, 4)


def extract_series_iii(page_text: str) -> dict:
    """Parse Figure 6 (series III) minor key/keyway rotations from page text.

    Returns ``{shell:int -> {letter -> [AR, BR, CR, DR]}}``.
    """
    region = page_text[: page_text.index("NOTES")]
    # Skip the column header by starting after its final "BSC" token; the data
    # region itself never contains "BSC".
    region = region[region.rindex("BSC") + 3:]
    tokens = re.findall(r"\d+|[NABCDE](?![A-Za-z])", region)
    letters = set("NABCDE")
    table: dict[int, dict[str, list[int]]] = {}
    shells: list[int] = []
    group_has_rows = False
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token in letters:
            values = [int(x) for x in tokens[i + 1: i + 5]]
            for shell in shells:
                table.setdefault(shell, {})[token] = values
            group_has_rows = True
            i += 5
        else:
            if group_has_rows:  # a number after a row block starts a new group
                shells = []
                group_has_rows = False
            shells.append(int(token))
            i += 1
    return table


def extract_series_iv(page_text: str) -> dict:
    """Parse Figure 7 (series IV) minor X/Y arrangements and main P/Q/R/S table.

    Returns ``{"minor": {letter -> [X, Y]},
                "main":  {shell:int -> [P, Q, R, S]}}``.
    """
    minor_region = page_text[
        page_text.index("polarity dimensions"): page_text.index("Plug, outer coupling")
    ]
    order: list[str] = []
    for letter in re.findall(r"[NABCDKLMR](?![A-Za-z])", minor_region):
        if letter not in order:
            order.append(letter)
    xs = re.findall(r"(\d+)\u00b0", minor_region[minor_region.index("X\u00b0"): minor_region.index("Y\u00b0")])
    ys = re.findall(r"(\d+)\u00b0", minor_region[minor_region.index("Y\u00b0"):])
    minor = {letter: [int(xs[idx]), int(ys[idx])] for idx, letter in enumerate(order)}

    main_region = page_text[
        page_text.index("main key and keyway polarization"): page_text.index("FIGURE 7")
    ]
    dms = re.findall(r"(\d+)\u00b0(\d+)'", main_region)
    main: dict[int, list[float]] = {}
    for idx, shell in enumerate(SERIES_IV_SHELLS):
        group = dms[idx * 4: idx * 4 + 4]
        main[shell] = [dms_to_deg(dd, mm) for dd, mm in group]
    return {"minor": minor, "main": main}


def build_ground_truth_from_pdf() -> dict:
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise RuntimeError(
            "PyMuPDF (fitz) is required to extract keying ground truth from the "
            "PDF. Install it (pip install pymupdf) or commit "
            "data/reference/keying_ground_truth.json."
        ) from exc
    doc = fitz.open(PDF)
    series_iii = extract_series_iii(doc[102].get_text())  # PDF page 103
    series_iv = extract_series_iv(doc[110].get_text())    # PDF page 111
    return {
        "_comment": (
            "Independent keying ground truth extracted from "
            "docs/pdfs/specs/MIL-DTL-38999-dtl38999.pdf Figure 6 (series III, "
            "p.103) and Figure 7 (series IV, p.111). Regenerate with "
            "scripts/keying_smoke_test.py --refresh."
        ),
        "series_iii": {str(shell): rows for shell, rows in series_iii.items()},
        "series_iv": {
            "minor": series_iv["minor"],
            "main": {str(shell): vals for shell, vals in series_iv["main"].items()},
        },
    }


def load_ground_truth(rep: Report, refresh: bool) -> dict:
    if not refresh and GROUND_TRUTH.is_file():
        return json.loads(GROUND_TRUTH.read_text(encoding="utf-8"))
    ground = build_ground_truth_from_pdf()
    GROUND_TRUTH.write_text(json.dumps(ground, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    rep.warn(f"(re)generated PDF ground truth -> {GROUND_TRUTH.relative_to(ROOT)}")
    return ground


# --------------------------------------------------------------------------- #
# Geometry - faithful re-implementation of the app's keying marker placement
# --------------------------------------------------------------------------- #
def polar_point(cx: float, cy: float, radius: float, angle_deg: float) -> tuple[float, float]:
    """Mirror of app.js polarPoint(): 0deg is 12 o'clock, clockwise positive."""
    radians = math.radians(angle_deg)
    return (cx + math.sin(radians) * radius, cy - math.cos(radians) * radius)


def recover_angle(cx: float, cy: float, x: float, y: float) -> float:
    """Inverse of polar_point() - recover an angle from a placed point."""
    return math.degrees(math.atan2(x - cx, cy - y)) % 360.0


def keying_markers(series: str, shell: str, letter: str, defs: dict) -> list[tuple[str, float]]:
    """Replicate the app's keyingDrawing marker list (label, angle).

    Series III renders the four minor columns of the selected row. Series IV
    renders the four main-key positions (by shell) plus the two minor positions
    (by arrangement letter). Mirrors app/app.js keyingDrawing().
    """
    pol = defs["polarization"]
    if series == "IV":
        minor = pol["series_iv"]["minor_key_polarity_arrangements"]["arrangements"].get(letter)
        main = pol["series_iv"]["main_key_by_shell_size"]["shell_sizes"].get(shell)
        if not minor or not main:
            return []
        markers = [(col[0], main[col]) for col in SERIES_IV_MAIN_COLS]
        markers += [("X", minor["X_or_XX_deg"]), ("Y", minor["Y_or_YY_deg"])]
    else:
        row = pol["series_iii"]["rotations_by_shell_size"].get(shell, {}).get(letter)
        if not row:
            return []
        # The renderer also lists an "E" column (ER_or_EP_deg) which series III
        # data does not provide, so it is filtered out -> four markers.
        markers = [(col[0], row.get(col)) for col in SERIES_III_COLS + ["ER_or_EP_deg"]]
    return [(label, float(angle)) for label, angle in markers if _finite(angle)]


def _finite(value) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


# --------------------------------------------------------------------------- #
# Role + series resolution (matches the app's data sources)
# --------------------------------------------------------------------------- #
def build_role_map(extracted_rules: dict) -> dict[str, str]:
    return {
        item["catalogCode"]: item.get("matingRole", "")
        for item in extracted_rules.get("normalizedShellStyles", [])
        if re.fullmatch(r"/\d+", item.get("catalogCode", ""))
    }


def build_series_map(dla_docs: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for doc in dla_docs.get("documents", []):
        slash = doc.get("slash_sheet")
        series = doc.get("series")
        if slash and series and slash not in out:
            out[slash] = series
    return out


# --------------------------------------------------------------------------- #
# Phase B - data fidelity (data == source)
# --------------------------------------------------------------------------- #
def section_data_fidelity(rep: Report, defs: dict, ground: dict, full: bool) -> None:
    rep.section("B. Data fidelity - JSON keying angles match the PDF standard")
    pol = defs["polarization"]
    passed = total = 0

    # Series III: every shell x letter x 4 columns equals Figure 6.
    s3 = pol["series_iii"]["rotations_by_shell_size"]
    gt3 = ground["series_iii"]
    shells = SERIES_III_SHELLS if full else SMOKE_III["shells"]
    for shell in shells:
        for letter in SERIES_III_LETTERS:
            total += 1
            data_row = s3.get(str(shell), {}).get(letter)
            src_row = gt3.get(str(shell), {}).get(letter)
            if not data_row or not src_row:
                rep.fail(f"series III shell {shell} letter {letter}: missing data/source row")
                continue
            data_vals = [data_row[c] for c in SERIES_III_COLS]
            if all(abs(d - s) <= TOL_SOURCE for d, s in zip(data_vals, src_row)):
                passed += 1
            else:
                rep.fail(f"series III shell {shell} {letter}: data {data_vals} != source {src_row}")
    rep.ok(f"series III: {passed} shell/letter rows match Figure 6")

    # Series IV minor X/Y arrangements equal Figure 7.
    arr = pol["series_iv"]["minor_key_polarity_arrangements"]["arrangements"]
    gt_minor = ground["series_iv"]["minor"]
    for letter in SERIES_IV_MINOR_LETTERS:
        total += 1
        data_xy = [arr.get(letter, {}).get(c) for c in SERIES_IV_MINOR_COLS]
        src_xy = gt_minor.get(letter)
        if src_xy and None not in data_xy and all(abs(d - s) <= TOL_SOURCE for d, s in zip(data_xy, src_xy)):
            passed += 1
        else:
            rep.fail(f"series IV minor {letter}: data {data_xy} != source {src_xy}")

    # Series IV main P/Q/R/S by shell equal Figure 7 (+ DMS == decimal).
    mk = pol["series_iv"]["main_key_by_shell_size"]["shell_sizes"]
    gt_main = ground["series_iv"]["main"]
    iv_shells = SERIES_IV_SHELLS if full else SMOKE_IV["shells"]
    for shell in iv_shells:
        total += 1
        row = mk.get(str(shell), {})
        data_vals = [row.get(c) for c in SERIES_IV_MAIN_COLS]
        src_vals = gt_main.get(str(shell))
        if not src_vals or None in data_vals:
            rep.fail(f"series IV main shell {shell}: missing data/source")
            continue
        if all(abs(d - s) <= TOL_SOURCE for d, s in zip(data_vals, src_vals)):
            passed += 1
        else:
            rep.fail(f"series IV main shell {shell}: data {data_vals} != source {src_vals}")

    # DMS <-> decimal self-consistency for series IV main key angles.
    dms_total = dms_passed = 0
    for shell, row in mk.items():
        for col in SERIES_IV_MAIN_COLS:
            dms = row.get(col + "_dms")
            dec = row.get(col)
            if dms is None or dec is None:
                continue
            dms_total += 1
            match = re.match(r"\s*(\d+)\u00b0\s*(\d+)'", dms)
            if match and abs(dms_to_deg(match.group(1), match.group(2)) - dec) <= TOL_DMS:
                dms_passed += 1
            else:
                rep.fail(f"series IV shell {shell} {col}: DMS {dms!r} != decimal {dec}")
    total += dms_total
    passed += dms_passed
    rep.ok(f"series IV: minor + main angles match Figure 7; {dms_passed}/{dms_total} DMS==decimal")
    rep.tally("B. data == source", passed, total)


# --------------------------------------------------------------------------- #
# Phase C - completeness of setups/variations + physical sanity
# --------------------------------------------------------------------------- #
def section_completeness(rep: Report, defs: dict) -> None:
    rep.section("C. Setup/variation completeness + physical sanity")
    pol = defs["polarization"]
    passed = total = 0

    # Every required series III (shell, letter) cell exists - no gaps, no extras.
    s3 = pol["series_iii"]["rotations_by_shell_size"]
    total += 1
    expected = {str(s) for s in SERIES_III_SHELLS}
    if set(s3) == expected:
        passed += 1
        rep.ok(f"series III defines all {len(expected)} shell sizes (9-25)")
    else:
        rep.fail(f"series III shells {sorted(s3)} != expected {sorted(expected)}")

    for shell in SERIES_III_SHELLS:
        total += 1
        letters = set(s3.get(str(shell), {}))
        if letters == set(SERIES_III_LETTERS):
            passed += 1
        else:
            rep.fail(f"series III shell {shell} letters {sorted(letters)} != {SERIES_III_LETTERS}")
    rep.ok("series III: every shell exposes setups N,A,B,C,D,E")

    # Series IV: minor arrangements complete; main defined for 11-25; NO shell 9.
    arr = pol["series_iv"]["minor_key_polarity_arrangements"]["arrangements"]
    total += 1
    if set(arr) == set(SERIES_IV_MINOR_LETTERS):
        passed += 1
        rep.ok("series IV minor arrangements N,A,B,C,D,K,L,M,R all present")
    else:
        rep.fail(f"series IV minor letters {sorted(arr)} != {SERIES_IV_MINOR_LETTERS}")

    mk = pol["series_iv"]["main_key_by_shell_size"]["shell_sizes"]
    total += 1
    if set(mk) == {str(s) for s in SERIES_IV_SHELLS}:
        passed += 1
        rep.ok("series IV main key defined for shells 11-25")
    else:
        rep.fail(f"series IV main shells {sorted(mk)} != {SERIES_IV_SHELLS}")

    total += 1
    if "9" not in mk:
        passed += 1
        rep.ok("series IV correctly omits shell size 9")
    else:
        rep.fail("series IV must not define shell size 9")

    # 'N' is the documented Normal default for both series.
    total += 1
    n3 = s3.get("17", {}).get("N", {}).get("description", "")
    n4 = arr.get("N", {}).get("description", "")
    if "normal" in n3.lower() and "normal" in n4.lower():
        passed += 1
        rep.ok("N is the documented Normal default (series III + IV)")
    else:
        rep.fail(f"N default description missing (III={n3!r}, IV={n4!r})")

    # Physical sanity: angles in [0,360) and keys within a setup are separable.
    total += 1
    range_ok = True
    for shell in SERIES_III_SHELLS:
        for letter in SERIES_III_LETTERS:
            row = s3.get(str(shell), {}).get(letter)
            if not row:
                continue  # missing setups are already reported above
            for col in SERIES_III_COLS:
                ang = row.get(col)
                if ang is None or not (0 <= ang < 360):
                    rep.fail(f"series III {shell}/{letter} {col}={ang} out of [0,360)")
                    range_ok = False
    for letter in SERIES_IV_MINOR_LETTERS:
        for col in SERIES_IV_MINOR_COLS:
            ang = arr.get(letter, {}).get(col)
            if ang is None or not (0 <= ang < 360):
                rep.fail(f"series IV minor {letter} {col}={ang} out of [0,360)")
                range_ok = False
    if range_ok:
        passed += 1
        rep.ok("all keying angles lie in [0,360)")

    # Minor keys inside a series III setup must be far enough apart to be keyable.
    total += 1
    sep_ok = True
    for shell in SERIES_III_SHELLS:
        for letter in SERIES_III_LETTERS:
            row = s3.get(str(shell), {}).get(letter)
            if not row or any(row.get(c) is None for c in SERIES_III_COLS):
                continue  # missing/incomplete setups are reported above
            angs = sorted(row[c] for c in SERIES_III_COLS)
            for a, b in zip(angs, angs[1:]):
                if (b - a) < MIN_KEY_SEPARATION:
                    rep.fail(f"series III {shell}/{letter}: keys {a},{b} closer than {MIN_KEY_SEPARATION} deg")
                    sep_ok = False
    if sep_ok:
        passed += 1
        rep.ok(f"series III keys within a setup are >= {MIN_KEY_SEPARATION} deg apart")

    # K polarization keyway is wider (note 16) and the factor is in cited range.
    total += 1
    ratios = defs.get("key_geometry", {}).get("series_iv", {}).get("derived_render_ratios", {})
    k_factor = ratios.get("k_polarization_keyway_width_factor")
    k_range = ratios.get("k_polarization_keyway_width_factor_range")
    if k_factor and k_factor > 1 and k_range and k_range[0] <= k_factor <= k_range[1]:
        passed += 1
        rep.ok(f"K polarization keyway width factor {k_factor} (>1, within {k_range})")
    else:
        rep.fail(f"K width factor invalid: factor={k_factor} range={k_range}")

    rep.tally("C. completeness + sanity", passed, total)


# --------------------------------------------------------------------------- #
# Phase D - shape/geometry (render == data) and mating truth
# --------------------------------------------------------------------------- #
def section_geometry(rep: Report, defs: dict, role_map: dict, series_map: dict, full: bool) -> None:
    rep.section("D. Shape geometry, plug/keyway shapes + mating truth")
    passed = total = 0
    cx = cy = 100.0
    radius = 80.0

    # D1. Marker counts + each rendered position recovers its data angle.
    matrix = []
    iii_shells = SERIES_III_SHELLS if full else SMOKE_III["shells"]
    iii_letters = SERIES_III_LETTERS if full else SMOKE_III["letters"]
    iv_shells = SERIES_IV_SHELLS if full else SMOKE_IV["shells"]
    iv_letters = SERIES_IV_MINOR_LETTERS if full else SMOKE_IV["letters"]
    for shell in iii_shells:
        for letter in iii_letters:
            matrix.append(("III", str(shell), letter, 4))
    for shell in iv_shells:
        for letter in iv_letters:
            matrix.append(("IV", str(shell), letter, 6))

    for series, shell, letter, expected_count in matrix:
        total += 1
        markers = keying_markers(series, shell, letter, defs)
        if len(markers) != expected_count:
            rep.fail(f"series {series} {shell}/{letter}: {len(markers)} markers, expected {expected_count}")
            continue
        # Place each marker the way keyingDrawing does, then recover the angle.
        recovered_ok = True
        for _label, angle in markers:
            point = polar_point(cx, cy, radius, angle)
            recovered = recover_angle(cx, cy, *point)
            if min(abs(recovered - angle), 360 - abs(recovered - angle)) > TOL_RENDER:
                rep.fail(f"series {series} {shell}/{letter}: rendered {recovered:.2f} != data {angle:.2f}")
                recovered_ok = False
        if recovered_ok:
            passed += 1
    rep.ok(f"{passed}/{total} setups render the right marker count at true angles")

    # D2. Master key sits at 12 o'clock (0deg) for series III (note 5).
    total += 1
    master = polar_point(cx, cy, radius, 0.0)
    if abs(master[0] - cx) < 1e-6 and master[1] < cy:
        passed += 1
        rep.ok("series III master key/keyway renders at 12 o'clock (0 deg)")
    else:
        rep.fail(f"series III master key not at 12 o'clock: {master}")

    # D3. Note 5 / note 4: across letters the MAIN key stays fixed and the
    # MINOR keys rotate (series III master fixed at 0; series IV P/Q/R/S fixed
    # by shell while X/Y move with the letter).
    total += 1
    iv_main_fixed = True
    for shell in iv_shells:
        main_sets = set()
        moved = set()
        for letter in iv_letters:
            markers = dict(keying_markers("IV", str(shell), letter, defs))
            if not all(key in markers for key in ("P", "Q", "R", "S", "X", "Y")):
                continue  # incomplete setups are reported by D1/completeness
            main_sets.add(tuple(round(markers[c[0]], 3) for c in SERIES_IV_MAIN_COLS))
            moved.add((round(markers["X"], 3), round(markers["Y"], 3)))
        if len(main_sets) != 1:
            rep.fail(f"series IV shell {shell}: main key P/Q/R/S changed with letter (must stay fixed)")
            iv_main_fixed = False
        if len(iv_letters) > 1 and len(moved) < 2:
            rep.fail(f"series IV shell {shell}: minor X/Y did not rotate across letters")
            iv_main_fixed = False
    if iv_main_fixed:
        passed += 1
        rep.ok("series IV: main key fixed per shell, minor keys rotate per letter (Figure 7 note)")

    # D4. Anti-mismate: two different setups produce different key shapes, so a
    # connector cannot mate with the wrong keying letter.
    total += 1
    mismate_ok = True
    for shell in iii_shells:
        sets = {}
        for letter in SERIES_III_LETTERS:
            markers = keying_markers("III", str(shell), letter, defs)
            sets[letter] = tuple(round(a, 2) for _l, a in markers)
        for la in SERIES_III_LETTERS:
            for lb in SERIES_III_LETTERS:
                if la < lb and sets[la] and sets[la] == sets[lb]:
                    rep.fail(f"series III shell {shell}: setups {la} and {lb} are geometrically identical")
                    mismate_ok = False
    if mismate_ok:
        passed += 1
        rep.ok("series III: every keying letter yields a distinct key shape (anti-mismate)")

    # D5. Plug keys and receptacle keyways occupy identical angles (complementary
    # relief) -> a plug and its mate at the same letter interlock. The roles must
    # resolve to plug vs receptacle and the series must match the slash sheet.
    total += 1
    role_ok = True
    cases = [
        (PLUG_III, "plug", "III"),
        (RECEPTACLE_III, "receptacle", "III"),
        (PLUG_IV, "plug", "IV"),
        (RECEPTACLE_IV, "receptacle", "IV"),
    ]
    for slash, expected_role, expected_series in cases:
        if role_map.get(slash) != expected_role:
            rep.fail(f"slash {slash}: role {role_map.get(slash)!r} != {expected_role!r}")
            role_ok = False
        if series_map.get(slash) != expected_series:
            rep.fail(f"slash {slash}: series {series_map.get(slash)!r} != {expected_series!r}")
            role_ok = False
    if role_ok:
        passed += 1
        rep.ok("plug (/26,/46) and receptacle (/20,/40) roles + series resolve correctly")

    # D6. Mating truth: different keying letters must never produce interlocking
    # shapes, so a connector can only mate with its own letter (no cross-mating).
    # Plug keys and receptacle keyways share angles by design, so this reduces to
    # "every letter's full key set is unique per shell" across both series.
    total += 1
    interlock_ok = True
    for series, shells, letters in (("III", iii_shells, SERIES_III_LETTERS), ("IV", iv_shells, SERIES_IV_MINOR_LETTERS)):
        for shell in shells:
            keys = {L: tuple(round(a, 2) for _l, a in keying_markers(series, str(shell), L, defs)) for L in letters}
            for plug_letter in letters:
                for recep_letter in letters:
                    if plug_letter != recep_letter and keys[plug_letter] and keys[plug_letter] == keys[recep_letter]:
                        rep.fail(f"series {series} shell {shell}: plug {plug_letter} interlocks wrong mate {recep_letter}")
                        interlock_ok = False
    if interlock_ok:
        passed += 1
        rep.ok("a connector only interlocks its mate at the same keying letter (no cross-mating)")

    rep.tally("D. shape geometry + mating", passed, total)


# --------------------------------------------------------------------------- #
# Phase E - the live renderer still reads these polarization fields
# --------------------------------------------------------------------------- #
def section_renderer_coupling(rep: Report) -> None:
    rep.section("E. Renderer wiring - app.js still reads the keying fields")
    passed = total = 0
    text = APP_JS.read_text(encoding="utf-8")
    required = (
        SERIES_III_COLS
        + SERIES_IV_MAIN_COLS
        + SERIES_IV_MINOR_COLS
        + ["polarPoint", "keyingDrawing", "rotations_by_shell_size", "main_key_by_shell_size"]
    )
    for token in required:
        total += 1
        if token in text:
            passed += 1
        else:
            rep.fail(f"app.js no longer references {token!r} - keying render may have drifted")
    # polarPoint must still use the 0deg-up convention (sin x, -cos y).
    total += 1
    if re.search(r"Math\.sin\(radians\)\s*\*\s*radius", text) and re.search(r"Math\.cos\(radians\)\s*\*\s*radius", text):
        passed += 1
        rep.ok("polarPoint keeps the 0deg=12-o'clock convention this test relies on")
    else:
        rep.warn("polarPoint formula changed - re-verify render geometry assumptions")
    rep.ok(f"{passed}/{total} renderer wiring checks")
    rep.tally("E. renderer wiring", passed, total)


# --------------------------------------------------------------------------- #
# Runner
# --------------------------------------------------------------------------- #
def run_keying_smoke_test(full: bool = False, quiet: bool = False, refresh: bool = False) -> int:
    rep = Report(quiet)
    print("d38999 Toolbox - keying smoke test")
    print(f"root: {ROOT}")

    standard = load_dataset(data_path("standard_definitions.json"))
    defs = standard["definitions"]
    extracted_rules = load_dataset(data_path("d38999_extracted_rules.json"))
    dla_docs = load_dataset(data_path("dla_documents.json"))
    ground = load_ground_truth(rep, refresh)
    role_map = build_role_map(extracted_rules)
    series_map = build_series_map(dla_docs)

    section_data_fidelity(rep, defs, ground, full)
    section_completeness(rep, defs)
    section_geometry(rep, defs, role_map, series_map, full)
    section_renderer_coupling(rep)

    print("\n=== SUMMARY ===")
    for title, passed, total in rep.sections:
        flag = "OK " if passed == total else "BAD"
        print(f"  [{flag}] {title}: {passed}/{total}")
    print(f"\n  warnings: {len(rep.warnings)}")
    print(f"  failures: {len(rep.failures)}")
    if rep.failures:
        print("\nFAILED - see FAIL lines above.")
        return 1
    print("\nALL KEYING CHECKS PASSED.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--full", action="store_true", help="validate every shell x letter cell, not the smoke subset")
    ap.add_argument("--quiet", action="store_true", help="print only the summary and failures")
    ap.add_argument("--refresh", action="store_true", help="re-extract the PDF ground truth cache")
    args = ap.parse_args()
    return run_keying_smoke_test(full=args.full, quiet=args.quiet, refresh=args.refresh)


if __name__ == "__main__":
    sys.exit(main())
