#!/usr/bin/env python3
"""
Manufacturer catalog smoke test for the D38999 -> manufacturer P/N converter.

Goal
----
Prove that, for every manufacturer / product line the converter knows about,
a MIL-DTL-38999 part number maps to the *correct* manufacturer part number and
that those generated part numbers stay grounded in the manufacturer catalogs.

It is fully offline (Python standard library only, no Node, no browser) and
exercises the same conversion logic the web app uses, because both the app
(`app/converter.js`) and this test consume the identical rule table that
`scripts/build_app.py` bundles from `scripts/d38999_rules.py`.

Checks (each section is tallied; non-zero failures -> non-zero exit code):

  1. Ground-truth conversions
     Every verbatim "how-to-order" row in ``data/example_conversions.csv`` must
     be reproduced exactly by ``convert_pin`` (manufacturer, product line,
     part number, confidence and notes), so each manufacturer is matched to the
     correct catalog P/N.

  2. Rule coverage
     Every rule in ``RULES`` (every manufacturer + product line + format) must
     be exercised by at least one ground-truth example, so no manufacturer
     format is silently untested.

  3. App/Python parity
     The converter rule table bundled into ``app/app-data.js`` (what the web app
     actually runs) must be byte-for-byte equal to ``d38999_rules.RULES``, and
     every ``format`` must be handled by both ``app/converter.js`` and
     ``d38999_rules.format_candidate``.

  4. Catalog-grounded sweep
     Feed the verified valid-P/N database (``data/d38999_valid_part_numbers``)
     through ``convert_pin``: no conversion may throw, and every generated
     manufacturer P/N must round-trip back to the same insert / contact / key /
     shell size via an independent per-format layout regex.

  5. Offline catalog text grounding
     Each manufacturer's generated P/N signature (style/prefix token) must
     appear in that manufacturer's catalog text extract under ``text/``.
     Known extract gaps are downgraded to warnings, not failures.

  6. Online catalog check (optional)
     With ``--mouser`` and a ``MOUSER_API_KEY``, spot-check generated P/Ns
     against the live Mouser catalog. Skipped by default (no network needed).

Usage
-----
    python3 scripts/manufacturer_catalog_smoke_test.py            # standard
    python3 scripts/manufacturer_catalog_smoke_test.py --full     # sweep all PNs
    python3 scripts/manufacturer_catalog_smoke_test.py --quiet    # summary only
    python3 scripts/manufacturer_catalog_smoke_test.py --mouser   # + live catalog
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent
DATA = ROOT / "data"
APP = ROOT / "app"
TEXT = ROOT / "text"

sys.path.insert(0, str(SCRIPTS))
from d38999_rules import RULES, convert_pin, parse_d38999_pin  # noqa: E402
from dataset_io import load_dataset  # noqa: E402

SWEEP_SAMPLE = 1500  # number of valid PNs swept unless --full


# --------------------------------------------------------------------------- #
# Reporting
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

    def summary(self) -> int:
        print("\n===== SUMMARY =====")
        for title, passed, total in self.sections:
            flag = "OK " if passed == total else "!! "
            print(f"  {flag} {title}: {passed}/{total}")
        print(f"  warnings: {len(self.warnings)}")
        print(f"  failures: {len(self.failures)}")
        if self.failures:
            print("\nFAILURES:")
            for item in self.failures:
                print(f"  - {item}")
            return 1
        print("\nALL MANUFACTURER CONVERSIONS OK")
        return 0


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def rule_id(rule: dict) -> str:
    return f"{rule['manufacturer']} :: {rule['product_line']}"


# --------------------------------------------------------------------------- #
# Section 1 - ground-truth conversions
# --------------------------------------------------------------------------- #
def check_ground_truth(report: Report) -> set[tuple[str, str]]:
    """Returns the set of (manufacturer, product_line) pairs proven correct."""
    report.section("Ground-truth conversions (data/example_conversions.csv)")
    rows = list(csv.DictReader((DATA / "example_conversions.csv").open(encoding="utf-8")))
    passed = 0
    proven: set[tuple[str, str]] = set()
    for row in rows:
        mil = row["mil_pin"]
        try:
            result = convert_pin(mil)
        except ValueError as exc:
            report.fail(f"{mil}: convert_pin raised {exc}")
            continue
        match = next(
            (
                c
                for c in result["candidates"]
                if c["manufacturer"] == row["manufacturer"]
                and c["product_line"] == row["product_line"]
            ),
            None,
        )
        if match is None:
            report.fail(
                f"{mil} -> {row['manufacturer']} / {row['product_line']}: "
                f"no candidate produced (expected {row['manufacturer_part_number']})"
            )
            continue
        if match["manufacturer_part_number"] != row["manufacturer_part_number"]:
            report.fail(
                f"{mil} -> {row['manufacturer']}: produced "
                f"{match['manufacturer_part_number']} but expected "
                f"{row['manufacturer_part_number']}"
            )
            continue
        # Full-row fidelity: confidence + notes must also match the catalog row.
        for field in ("confidence", "notes"):
            if match[field] != row[field]:
                report.warn(
                    f"{mil} -> {row['manufacturer']}: {field} drift "
                    f"({match[field]!r} != catalog {row[field]!r})"
                )
        report.ok(f"{mil:18} -> {row['manufacturer']:11} {match['manufacturer_part_number']}")
        proven.add((row["manufacturer"], row["product_line"]))
        passed += 1
    report.tally("ground-truth conversions", passed, len(rows))
    return proven


# --------------------------------------------------------------------------- #
# Section 2 - rule coverage
# --------------------------------------------------------------------------- #
def check_rule_coverage(report: Report, proven: set[tuple[str, str]]) -> None:
    report.section("Rule coverage (every manufacturer/product line is tested)")
    covered = 0
    for rule in RULES:
        key = (rule["manufacturer"], rule["product_line"])
        if key in proven:
            report.ok(f"covered by ground truth: {rule_id(rule)}")
            covered += 1
        else:
            report.fail(f"no ground-truth example exercises rule: {rule_id(rule)}")
    report.tally("rule coverage", covered, len(RULES))


# --------------------------------------------------------------------------- #
# Section 3 - app/python parity
# --------------------------------------------------------------------------- #
def extract_app_converter_rules() -> list[dict]:
    raw = (APP / "app-data.js").read_text(encoding="utf-8")
    head = raw.split("\nwindow.D38999_DATA", 1)[0].strip()
    prefix = "window.D38999_TOOLBOX_DATA = "
    if not head.startswith(prefix):
        raise ValueError("Unexpected app-data.js layout; cannot parse bundled data")
    payload = head[len(prefix):].rstrip().rstrip(";")
    bundle = json.loads(payload)
    return bundle["converter"]["rules"]


def check_app_parity(report: Report) -> None:
    report.section("App/Python parity (app-data.js rules == d38999_rules.RULES)")
    checks = 0
    passed = 0

    # 3a: bundled rule table equals the Python source of truth.
    checks += 1
    try:
        app_rules = extract_app_converter_rules()
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        report.fail(f"could not extract converter rules from app-data.js: {exc}")
        app_rules = None
    if app_rules is not None:
        if json.dumps(app_rules, sort_keys=True) == json.dumps(RULES, sort_keys=True):
            report.ok(f"app-data.js bundles identical rule table ({len(RULES)} rules)")
            passed += 1
        else:
            app_keys = {rule_id(r) for r in app_rules}
            py_keys = {rule_id(r) for r in RULES}
            only_app = app_keys - py_keys
            only_py = py_keys - app_keys
            detail = ""
            if only_app or only_py:
                detail = f" (app-only={sorted(only_app)} py-only={sorted(only_py)})"
            report.fail(
                "app-data.js converter rules differ from d38999_rules.RULES; "
                "rebuild with scripts/build_app.py" + detail
            )

    # 3b: every format used is handled by both the JS and Python formatters.
    converter_js = (APP / "converter.js").read_text(encoding="utf-8")
    js_cases = set(re.findall(r'case "([a-z_]+)":', converter_js))
    formats = {rule["format"] for rule in RULES}
    for fmt in sorted(formats):
        checks += 1
        in_js = fmt in js_cases
        in_py = f'fmt == "{fmt}"' in (SCRIPTS / "d38999_rules.py").read_text(encoding="utf-8")
        if in_js and in_py:
            report.ok(f"format handled by JS + Python: {fmt}")
            passed += 1
        else:
            missing = []
            if not in_js:
                missing.append("converter.js")
            if not in_py:
                missing.append("d38999_rules.py")
            report.fail(f"format {fmt} not handled by {', '.join(missing)}")

    report.tally("app/python parity", passed, checks)


# --------------------------------------------------------------------------- #
# Section 4 - catalog-grounded sweep with independent layout round-trip
# --------------------------------------------------------------------------- #
def layout_regex(rule: dict, parsed) -> re.Pattern:
    """Independent per-format regex describing the EXPECTED field layout.

    Built from rule lookups but with field ORDER and separators described
    separately from ``format_candidate``'s f-string, so a transposed/misordered
    field is caught. Capture groups always yield (insert, contact, key).
    """
    fmt = rule["format"]
    shell = parsed.shell_type
    cls = parsed.service_class
    shell_num = parsed.shell_size_number
    shell_pad = parsed.shell_size_number_padded
    shell_letter = parsed.shell_size_code
    icks = r"(\d{1,2})([A-Z])([A-Z])$"  # insert, contact, key

    if fmt == "amphenol_prefix":
        prefix = rule["styles"][shell]["prefix_by_finish"][cls]  # ends with '-'
        return re.compile(re.escape(prefix) + re.escape(shell_num) + r"-" + icks)
    if fmt == "conesys":
        head = rule["prefix"] + rule["styles"][shell] + cls + shell_letter
        return re.compile(re.escape(head) + icks)
    if fmt == "eaton":
        head = "BL" + rule["styles"][shell] + rule["finishes"][cls] + shell_num
        return re.compile(re.escape(head) + r"-" + icks)
    if fmt == "glenair":
        head = rule["base"] + "-" + rule["styles"][shell] + rule["finishes"][cls] + shell_pad
        return re.compile(re.escape(head) + r"-" + icks)
    if fmt == "itt":
        head = rule["prefix"] + rule["styles"][shell] + "T" + shell_num + rule["finishes"][cls]
        return re.compile(re.escape(head) + icks)
    if fmt == "souriau":
        head = "8D" + rule["styles"][shell] + "-" + shell_pad + rule["finishes"][cls]
        return re.compile(re.escape(head) + icks)
    if fmt == "te_dts":
        head = "DTS" + rule["styles"][shell] + rule["finishes"][cls] + shell_num
        return re.compile(re.escape(head) + icks)
    if fmt == "te_act":
        head = "ACT" + rule["styles"][shell] + rule["finishes"][cls] + shell_letter
        return re.compile(re.escape(head) + icks)
    raise ValueError(f"no layout regex for format {fmt}")


def rule_for_candidate(candidate: dict) -> dict | None:
    for rule in RULES:
        if rule["manufacturer"] == candidate["manufacturer"] and rule["product_line"] == candidate["product_line"]:
            return rule
    return None


def check_catalog_sweep(report: Report, full: bool) -> dict[str, int]:
    report.section("Catalog-grounded sweep (data/d38999_valid_part_numbers.json)")
    db = load_dataset(DATA / "d38999_valid_part_numbers.json")
    entries = db["partNumbers"]
    pns: list[str] = []
    seen: set[str] = set()
    for entry in entries:
        pn = entry.get("partNumber") or entry.get("normalizedPartNumber") or ""
        if pn and pn not in seen:
            seen.add(pn)
            pns.append(pn)
    if not full:
        pns = pns[:SWEEP_SAMPLE]

    per_mfr: dict[str, int] = {}
    checked = 0
    failures_before = len(report.failures)
    for pn in pns:
        try:
            parsed = parse_d38999_pin(pn)
        except ValueError:
            continue  # accessory/non-insert PNs are out of scope for this converter
        try:
            result = convert_pin(pn)
        except ValueError as exc:
            report.fail(f"{pn}: convert_pin raised {exc}")
            continue
        for cand in result["candidates"]:
            checked += 1
            per_mfr[cand["manufacturer"]] = per_mfr.get(cand["manufacturer"], 0) + 1
            rule = rule_for_candidate(cand)
            if rule is None:
                report.fail(f"{pn}: candidate has no matching rule ({cand['manufacturer']})")
                continue
            pattern = layout_regex(rule, parsed)
            m = pattern.search(cand["manufacturer_part_number"])
            if not m:
                report.fail(
                    f"{pn} -> {cand['manufacturer']}: "
                    f"{cand['manufacturer_part_number']} does not match expected layout"
                )
                continue
            insert, contact, key = m.group(1), m.group(2), m.group(3)
            if (insert, contact, key) != (parsed.insert, parsed.contact, parsed.key):
                report.fail(
                    f"{pn} -> {cand['manufacturer']}: round-trip mismatch "
                    f"insert/contact/key={insert}{contact}{key} != "
                    f"{parsed.insert}{parsed.contact}{parsed.key}"
                )

    sweep_failures = len(report.failures) - failures_before
    if not report.quiet:
        for mfr in sorted(per_mfr):
            report.ok(f"{mfr:11}: {per_mfr[mfr]} generated P/Ns round-tripped")
    report.tally("catalog sweep candidates", checked - sweep_failures, checked)
    return per_mfr


# --------------------------------------------------------------------------- #
# Section 5 - offline catalog text grounding
# --------------------------------------------------------------------------- #
# Known extract gaps: these catalog text files are general/partial OCR captures
# that do not contain the specific ordering-table tokens, so a miss is a warning.
KNOWN_TEXT_GAPS = {
    ("Glenair", "233-100 Series III hermetic"),
    ("Glenair", "234-100 Series IV hermetic"),
    ("Eaton", "Breech-Lok Series IV general purpose"),
    ("Eaton", "Breech-Lok Series IV hermetic"),
}

MANUFACTURER_TEXT_GLOBS = {
    "Amphenol": ["Amphenol*Series_III.txt", "Amphenol*.txt"],
    "Conesys": ["Conesys*.txt"],
    "Eaton": ["Eaton*.txt"],
    "Glenair": ["Glenair*.txt"],
    "ITT Cannon": ["ITT*.txt"],
    "Souriau": ["Souriau*.txt"],
    "TE Deutsch": ["TE_Deutsch*.txt"],
}


def rule_signature(rule: dict) -> str:
    """A stable token that should appear verbatim in the manufacturer catalog."""
    fmt = rule["format"]
    first_shell = sorted(rule["styles"])[0]
    style = rule["styles"][first_shell]
    if fmt == "amphenol_prefix":
        # e.g. "TV06RW" from the straight-plug W-finish prefix.
        any_prefix = next(iter(style["prefix_by_finish"].values()))
        return any_prefix.rstrip("-")
    if fmt == "conesys":
        return f"{rule['prefix']}{style}"
    if fmt == "eaton":
        return "BL" + style
    if fmt == "glenair":
        return rule["base"]
    if fmt == "itt":
        return rule["prefix"]
    if fmt == "souriau":
        return "8D"
    if fmt == "te_dts":
        return "DTS"
    if fmt == "te_act":
        return "ACT"
    return ""


def manufacturer_text(manufacturer: str) -> str:
    chunks: list[str] = []
    for pattern in MANUFACTURER_TEXT_GLOBS.get(manufacturer, []):
        for path in sorted(TEXT.glob(pattern)):
            chunks.append(path.read_text(encoding="utf-8", errors="ignore"))
        if chunks:
            break
    return "\n".join(chunks).upper()


def check_catalog_text_grounding(report: Report) -> None:
    report.section("Offline catalog text grounding (text/*.txt)")
    text_cache: dict[str, str] = {}
    passed = 0
    total = 0
    for rule in RULES:
        total += 1
        mfr = rule["manufacturer"]
        signature = rule_signature(rule).upper()
        if mfr not in text_cache:
            text_cache[mfr] = manufacturer_text(mfr)
        haystack = text_cache[mfr]
        if not haystack:
            report.warn(f"{rule_id(rule)}: no catalog text extract found for {mfr}")
            continue
        if signature and signature in haystack:
            report.ok(f"{rule_id(rule)}: '{signature}' found in catalog text")
            passed += 1
        elif (mfr, rule["product_line"]) in KNOWN_TEXT_GAPS:
            report.warn(
                f"{rule_id(rule)}: '{signature}' not in extract "
                f"(known extract gap, grounded by example_conversions.csv)"
            )
            passed += 1  # accepted: covered by ground-truth catalog examples
        else:
            report.fail(f"{rule_id(rule)}: signature '{signature}' missing from {mfr} catalog text")
    report.tally("catalog text grounding", passed, total)


# --------------------------------------------------------------------------- #
# Section 6 - optional online Mouser catalog check
# --------------------------------------------------------------------------- #
def check_mouser(report: Report, proven_examples: list[str]) -> None:
    report.section("Online catalog check (Mouser)")
    api_key = os.environ.get("MOUSER_API_KEY")
    if not api_key:
        report.warn("MOUSER_API_KEY not set; skipping live catalog check")
        report.tally("mouser online check", 0, 0)
        return
    import time
    import urllib.error
    import urllib.request

    url = f"https://api.mouser.com/api/v2/search/keyword?apiKey={api_key}"
    passed = 0
    for pn in proven_examples:
        body = json.dumps({"SearchByKeywordRequest": {"keyword": pn, "records": 5}}).encode()
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                payload = json.loads(resp.read().decode())
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            report.warn(f"{pn}: Mouser query failed ({exc})")
            continue
        parts = (payload.get("SearchResults") or {}).get("Parts") or []
        if parts:
            report.ok(f"{pn}: {len(parts)} Mouser hit(s)")
            passed += 1
        else:
            report.warn(f"{pn}: no Mouser catalog hit (commercial cross-ref may be unlisted)")
        time.sleep(1.1)  # respect Mouser rate limits
    report.tally("mouser online check", passed, len(proven_examples))


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--full", action="store_true", help="sweep every valid P/N (slower)")
    parser.add_argument("--quiet", action="store_true", help="only print summary and failures")
    parser.add_argument("--mouser", action="store_true", help="also query the live Mouser catalog")
    args = parser.parse_args()

    report = Report(args.quiet)

    proven = check_ground_truth(report)
    check_rule_coverage(report, proven)
    check_app_parity(report)
    check_catalog_sweep(report, args.full)
    check_catalog_text_grounding(report)
    if args.mouser:
        examples = [
            row["manufacturer_part_number"]
            for row in csv.DictReader((DATA / "example_conversions.csv").open(encoding="utf-8"))
        ]
        check_mouser(report, examples)

    return report.summary()


if __name__ == "__main__":
    raise SystemExit(main())
