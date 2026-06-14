#!/usr/bin/env python3
"""Extensive 1:1 consistency validation for the D38999 toolbox datasets.

This harness proves that every connector technical fact the toolbox ships is
internally consistent and "1 to 1" with its canonical source. It is the data
counterpart to the headless-browser UI check in ``tests/validate_app.js`` and
the round-trip converters in ``scripts/*_roundtrip_test.py``.

Validation groups
-----------------
A. Bundle <-> source 1:1 parity
   ``app/app-data.js`` must equal a fresh build from ``data/**`` +
   ``scripts/d38999_rules.py``. Any drift (someone edited a source but did not
   re-run ``scripts/build_app.py``) is a hard failure.

B. Part numbers
   Every Series III/IV part number in the unified valid-PN corpus and the
   DLA QPL-1122 list must decode with the canonical parser, the decode must be
   idempotent (re-parsing the normalized form is stable), and the decoded
   fields must match the decode stored alongside the PN (shell type, class,
   shell-size code, insert, contact style, keying).

C. Insert arrangements
   63 arrangements / 1747 contacts; ``id`` == ``shell_size`` - ``arrangement
   _number``; ``shell_size`` matches its ``shell_size_code``; contact counts
   agree; pin labels are unique and non-empty; every contact size has a
   current rating.

D. Conversions (forward + reverse round-trip)
   Runs the existing converter round-trip, exhaustive round-trip and the
   manufacturer-catalog (Python/JS parity) smoke tests, and checks the
   converter rule table only references known classes / shell types / contacts
   / keys.

E. Technical-spec cross-consistency
   Shell-size codes, classes, contact styles and keying letters agree across
   ``standard_definitions.json``, ``part_number_rules.json`` and
   ``scripts/d38999_rules.py``; the two current-rating tables agree on every
   overlapping contact size.

Exit code is non-zero if any FAIL-severity check fails. WARN-severity findings
(intentional supersets, missing optional tooling) are reported but do not fail
the run unless ``--strict`` is given.

Usage:
    python3 scripts/validate_dataset_consistency.py
    python3 scripts/validate_dataset_consistency.py --strict
    python3 scripts/validate_dataset_consistency.py --skip-roundtrip
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts import d38999_rules as rules  # noqa: E402
from scripts.dataset_io import data_path, load_dataset  # noqa: E402
from scripts.build_valid_d38999_pns import (  # noqa: E402
    decode_part_number as valid_pn_builder_decode_part_number,
    keying_letter_valid,
)

APP_DATA_JS = ROOT / "app" / "app-data.js"

# Canonical sources that build_app.py bakes into the embedded bundle, mirrored
# here so Group A can rebuild the embedded object without side effects.
PINOUT_SOURCES = {
    "insertArrangements": "insert_arrangements.json",
    "partNumberRules": "part_number_rules.json",
    "pinoutRules": "pinout_rules.json",
    "standardDefinitions": "standard_definitions.json",
    "dlaDocuments": "dla_documents.json",
    "reviewNeeded": "review_needed.json",
    "contactCurrentRatings": "contact_current_ratings.json",
}
RESEARCH_SOURCES = {
    "extractedRules": "d38999_extracted_rules.json",
    "partNumberExamples": "d38999_part_number_examples.json",
    "catalogSupportedCombinations": "d38999_catalog_supported_combinations.json",
    "verifiedPartNumbers": "d38999_verified_part_numbers.json",
    "federalConnectorsSecondarySource": "d38999_federalconnectors_secondary_source.json",
    "visualAssets": "d38999_visual_assets.json",
}


class Report:
    """Collects PASS / WARN / FAIL findings grouped by validation area."""

    def __init__(self) -> None:
        self.passes = 0
        self.warns: list[str] = []
        self.fails: list[str] = []
        self._group = ""

    def group(self, name: str) -> None:
        self._group = name
        print(f"\n=== {name} ===")

    def check(self, ok: bool, message: str, *, warn: bool = False) -> bool:
        if ok:
            self.passes += 1
            print(f"  PASS  {message}")
            return True
        label = "WARN" if warn else "FAIL"
        (self.warns if warn else self.fails).append(f"[{self._group}] {message}")
        print(f"  {label}  {message}")
        return False


# --------------------------------------------------------------------------- #
# Bundle helpers
# --------------------------------------------------------------------------- #

def read_json(name: str) -> Any:
    return json.loads(data_path(name).read_text(encoding="utf-8"))


def parse_embedded_bundle() -> dict[str, Any]:
    """Extract the embedded ``window.D38999_TOOLBOX_DATA`` object literal."""
    text = APP_DATA_JS.read_text(encoding="utf-8")
    marker = "window.D38999_TOOLBOX_DATA = "
    start = text.index(marker) + len(marker)
    # The object literal ends just before the ";\nwindow.D38999_DATA" tail.
    end = text.index(";\nwindow.D38999_DATA", start)
    return json.loads(text[start:end])


def build_expected_bundle() -> dict[str, Any]:
    """Rebuild the embedded object exactly as ``build_app.build`` would, but
    without touching the filesystem."""
    return {
        "pinout": {
            "insertArrangements": read_json("insert_arrangements.json"),
            "partNumberRules": read_json("part_number_rules.json"),
            "pinoutRules": read_json("pinout_rules.json"),
            "standardDefinitions": read_json("standard_definitions.json"),
            "dlaDocuments": read_json("dla_documents.json"),
            "reviewNeeded": read_json("review_needed.json"),
            "contactCurrentRatings": read_json("contact_current_ratings.json"),
        },
        "converter": {
            "shell_size_numbers": rules.SHELL_SIZE_NUMBERS,
            "series_by_shell_type": rules.SERIES_BY_SHELL_TYPE,
            "mil_shell_types": rules.MIL_SHELL_TYPES,
            "known_classes": rules.KNOWN_CLASSES,
            "contact_descriptions": rules.CONTACT_DESCRIPTIONS,
            "rules": rules.RULES,
        },
        "research": {
            "extractedRules": read_json("d38999_extracted_rules.json"),
            "partNumberExamples": read_json("d38999_part_number_examples.json"),
            "catalogSupportedCombinations": read_json("d38999_catalog_supported_combinations.json"),
            "validPartNumbers": load_dataset(data_path("d38999_valid_part_numbers.json")),
            "verifiedPartNumbers": read_json("d38999_verified_part_numbers.json"),
            "federalConnectorsSecondarySource": read_json("d38999_federalconnectors_secondary_source.json"),
            "visualAssets": read_json("d38999_visual_assets.json"),
        },
        "ruggedIo": read_json("rugged_io_d38999_style_connectors.json"),
    }


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def standard_keys_by_series() -> dict[str, set[str]]:
    """Authoritative polarization (keying) letters per series, taken straight
    from ``standard_definitions.json`` (MIL-DTL-38999 Figures 6 & 7)."""
    pol = read_json("standard_definitions.json")["definitions"]["polarization"]
    series_iii = set()
    for letters in pol["series_iii"]["rotations_by_shell_size"].values():
        series_iii.update(letters.keys())
    series_iv = set(pol["series_iv"]["minor_key_polarity_arrangements"]["arrangements"].keys())
    return {"III": series_iii, "IV": series_iv}


# --------------------------------------------------------------------------- #
# Group A — bundle <-> source 1:1 parity
# --------------------------------------------------------------------------- #

def validate_bundle_parity(rep: Report) -> None:
    rep.group("A. Bundle <-> source 1:1 parity")
    if not rep.check(APP_DATA_JS.exists(), f"app bundle exists: {APP_DATA_JS.relative_to(ROOT)}"):
        return
    embedded = parse_embedded_bundle()
    expected = build_expected_bundle()

    rep.check(set(embedded.keys()) == set(expected.keys()),
              f"bundle top-level sections match source ({sorted(embedded.keys())})")

    # Compare each section independently so drift is pinpointed to a source file.
    section_keys = {
        "pinout": PINOUT_SOURCES,
        "research": RESEARCH_SOURCES,
    }
    for section, sources in section_keys.items():
        emb_sec = embedded.get(section, {})
        exp_sec = expected.get(section, {})
        for key in sources:
            ok = _canonical(emb_sec.get(key)) == _canonical(exp_sec.get(key))
            rep.check(ok, f"bundle.{section}.{key} == data/{sources[key]}")
        # validPartNumbers is reassembled from the sharded corpus.
        if section == "research":
            ok = _canonical(emb_sec.get("validPartNumbers")) == _canonical(exp_sec.get("validPartNumbers"))
            rep.check(ok, "bundle.research.validPartNumbers == data/d38999_valid_part_numbers (sharded)")

    for key in ("shell_size_numbers", "series_by_shell_type", "mil_shell_types",
                "known_classes", "contact_descriptions", "rules"):
        ok = _canonical(embedded["converter"].get(key)) == _canonical(expected["converter"].get(key))
        rep.check(ok, f"bundle.converter.{key} == scripts/d38999_rules.py")

    rep.check(_canonical(embedded.get("ruggedIo")) == _canonical(expected.get("ruggedIo")),
              "bundle.ruggedIo == data/rugged_io_d38999_style_connectors.json")


# --------------------------------------------------------------------------- #
# Group B — part numbers
# --------------------------------------------------------------------------- #

def _decode_to_fields(parsed: rules.ParsedPin) -> dict[str, str]:
    return {
        "slashSheet": f"/{parsed.shell_type}",
        "class": parsed.service_class,
        "shellSizeCode": parsed.shell_size_code,
        "insertArrangement": parsed.insert,
        "contactStyle": parsed.contact,
        "keying": parsed.key,
    }


# The canonical MIL-DTL-38999 Series III/IV slash-sheet PIN grammar the toolbox
# parser targets: 2-digit slash sheet, 1-2 letter class, a shell-size LETTER
# (A-H/J), numeric insert, contact-style letter, optional polarization letter.
# This regex was verified to accept exactly the same PNs as
# ``parse_d38999_pin`` across the full 44k-PN corpus (0 disagreements), so it is
# an authoritative definition of "is this a decodable Series III/IV PIN".
CANONICAL_PIN = re.compile(r"^D38999/(\d{2})([A-Z]{1,2})([A-HJ])(\d{1,3})([A-Z])([A-Z]?)$")


def _compact(pn: str) -> str:
    return re.sub(r"[\s-]+", "", (pn or "").upper())


def is_canonical_pin(pn: str) -> bool:
    compact = _compact(pn)
    m = CANONICAL_PIN.match(compact)
    return bool(m) and rules.SERIES_BY_SHELL_TYPE.get(m.group(1)) is not None


def classify_non_canonical(pn: str) -> str:
    """Bucket a real-world part number that is not a canonical Series III/IV PIN."""
    compact = _compact(pn)
    if compact.startswith("MS") or compact.startswith("M38999"):
        return "series_i_ii_legacy"
    m = re.match(r"^D38999/(\d{2})(.*)$", compact)
    if not m:
        return "non_d38999"
    shell, body = m.group(1), m.group(2)
    if rules.SERIES_BY_SHELL_TYPE.get(shell) is None:
        return "non_letter_code_slash_sheet"  # e.g. /9, /10, /22, /50, /28...
    # Shell type is a canonical one but the body deviates from the PIN grammar.
    if re.match(r"^[A-Z]{1,2}\d", body):
        return "numeric_shell_size_variant"   # e.g. /32F11N, /33M13R
    if re.match(r"^[A-Z]{1,2}[A-HJ]\d{1,3}[A-Z][A-Z]?.+$", body):
        return "trailing_variant_suffix"      # e.g. /31JE20PN5
    if not re.search(r"\d", body):
        return "partial_family_pn"            # e.g. /22AM (no insert number)
    return "other"


def validate_part_numbers(rep: Report) -> None:
    rep.group("B. Part numbers")
    corpus = load_dataset(data_path("d38999_valid_part_numbers.json"))
    records = corpus["partNumbers"]
    rep.check(len(records) > 0, f"valid-PN corpus loaded ({len(records)} records)")

    parse_errors: list[str] = []
    decode_mismatches: list[str] = []
    normalize_mismatches: list[str] = []
    idempotency_failures: list[str] = []
    partial_field_errors: list[str] = []
    canonical = 0
    non_canonical: dict[str, int] = {}

    for rec in records:
        pn = rec.get("normalizedPartNumber") or rec.get("partNumber")
        if not is_canonical_pin(pn):
            bucket = classify_non_canonical(pn)
            non_canonical[bucket] = non_canonical.get(bucket, 0) + 1
            # Even partial entries must keep self-consistent decode fields.
            d = rec.get("decoded") or {}
            code = d.get("shellSizeCode")
            cls = d.get("class")
            if code and code not in rules.SHELL_SIZE_NUMBERS:
                partial_field_errors.append(f"{pn}: shellSizeCode {code!r}")
            if cls and cls not in rules.KNOWN_CLASSES:
                partial_field_errors.append(f"{pn}: class {cls!r}")
            continue

        canonical += 1
        try:
            parsed = rules.parse_d38999_pin(pn)
        except Exception as exc:  # noqa: BLE001
            parse_errors.append(f"{pn}: {exc}")
            continue

        # Idempotency: re-parsing the normalized form must be stable.
        try:
            if rules.parse_d38999_pin(parsed.normalized).normalized != parsed.normalized:
                idempotency_failures.append(pn)
        except Exception as exc:  # noqa: BLE001
            idempotency_failures.append(f"{pn}: {exc}")

        # Decoded fields must match the decode stored next to the PN.
        stored = dict(rec.get("decoded") or {})
        if stored:
            if not stored.get("keying"):
                stored["keying"] = "N"
            got = _decode_to_fields(parsed)
            for field, value in got.items():
                if str(stored.get(field, "")).upper() != str(value).upper():
                    decode_mismatches.append(
                        f"{pn}: {field} stored={stored.get(field)!r} decoded={value!r}")
                    break

        # The corpus normalized form must round-trip through the parser.
        if rec.get("normalizedPartNumber") and parsed.normalized != _compact(rec["normalizedPartNumber"]):
            normalize_mismatches.append(
                f"{rec['normalizedPartNumber']} -> {parsed.normalized}")

    rep.check(not parse_errors,
              f"all {canonical} canonical Series III/IV corpus PINs decode"
              + (f" ({len(parse_errors)} errors, e.g. {parse_errors[:3]})" if parse_errors else ""))
    rep.check(not idempotency_failures,
              "decode is idempotent on normalized form"
              + (f" ({len(idempotency_failures)} failures, e.g. {idempotency_failures[:3]})" if idempotency_failures else ""))
    rep.check(not normalize_mismatches,
              "stored normalizedPartNumber == parser normalized form"
              + (f" ({len(normalize_mismatches)} mismatches, e.g. {normalize_mismatches[:3]})" if normalize_mismatches else ""))
    rep.check(not decode_mismatches,
              "stored decode fields == parser decode for every canonical PIN"
              + (f" ({len(decode_mismatches)} mismatches, e.g. {decode_mismatches[:3]})" if decode_mismatches else ""))
    rep.check(not partial_field_errors,
              "non-canonical entries keep consistent partial decode fields"
              + (f" ({len(partial_field_errors)} bad, e.g. {partial_field_errors[:3]})" if partial_field_errors else ""))

    # Every corpus PN's keying letter must be legal for its connector series
    # (MIL-DTL-38999 Figures 6 & 7): Series III (/20-/27) = N,A,B,C,D,E,
    # Series IV (/40-/49) = N,A,B,C,D,K,L,M,R. The corpus build drops illegal
    # keys; this re-verifies the committed corpus so a stray/typo keying letter
    # (e.g. a finish code scraped into the keying slot) can never slip back in.
    keying_violations = [
        f"{rec.get('partNumber')} (slash {(rec.get('decoded') or {}).get('slashSheet')}, "
        f"key {(rec.get('decoded') or {}).get('keying')}, {rec.get('evidenceLevel')})"
        for rec in records
        if not keying_letter_valid((rec.get("decoded") or {}).get("slashSheet"),
                                   (rec.get("decoded") or {}).get("keying"))
    ]
    rep.check(not keying_violations,
              "every corpus PN keying letter is legal for its series"
              + (f" ({len(keying_violations)} illegal, e.g. {keying_violations[:3]})" if keying_violations else ""))
    if non_canonical:
        total_nc = sum(non_canonical.values())
        print(f"  INFO  corpus has {total_nc} non-canonical entries: "
              + ", ".join(f"{k}={v}" for k, v in sorted(non_canonical.items())))

    # DLA QPL-1122: every canonical Series III/IV entry must decode; the rest are
    # bucketed (legacy Series I/II, special numeric-shell sheets, variant suffixes).
    qpl = read_json("qpl_1122_part_numbers.json")["part_numbers"]
    qpl_checked = 0
    qpl_errors: list[str] = []
    qpl_buckets: dict[str, int] = {}
    for pn in qpl:
        if is_canonical_pin(pn):
            try:
                rules.parse_d38999_pin(pn)
                qpl_checked += 1
            except Exception as exc:  # noqa: BLE001
                qpl_errors.append(f"{pn}: {exc}")
        else:
            b = classify_non_canonical(pn)
            qpl_buckets[b] = qpl_buckets.get(b, 0) + 1
    rep.check(not qpl_errors,
              f"all {qpl_checked} canonical Series III/IV QPL-1122 PNs decode"
              + (f"; errors e.g. {qpl_errors[:3]}" if qpl_errors else ""))
    if qpl_buckets:
        print(f"  INFO  QPL-1122 has {sum(qpl_buckets.values())} non-canonical entries: "
              + ", ".join(f"{k}={v}" for k, v in sorted(qpl_buckets.items())))


# --------------------------------------------------------------------------- #
# Group C — insert arrangements
# --------------------------------------------------------------------------- #

def validate_arrangements(rep: Report) -> None:
    rep.group("C. Insert arrangements")
    data = read_json("insert_arrangements.json")
    arrangements = data.get("arrangements", [])
    rep.check(len(arrangements) == 63, f"63 insert arrangements present (got {len(arrangements)})")
    rep.check(data.get("arrangement_count") == len(arrangements),
              "arrangement_count header matches arrangement list length")

    total_contacts = sum(len(a.get("contacts", [])) for a in arrangements)
    rep.check(total_contacts == 1747, f"1747 contacts total (got {total_contacts})")

    rating_sizes = {str(r["contact_size"]) for r in read_json("contact_current_ratings.json")["ratings"]}

    id_errors: list[str] = []
    shell_errors: list[str] = []
    count_errors: list[str] = []
    label_errors: list[str] = []
    coord_errors: list[str] = []
    size_errors: list[str] = []
    seen_ids: set[str] = set()
    dup_ids: list[str] = []

    for a in arrangements:
        aid = a.get("id")
        shell = str(a.get("shell_size"))
        code = a.get("shell_size_code")
        num = str(a.get("arrangement_number"))
        contacts = a.get("contacts", [])

        if aid in seen_ids:
            dup_ids.append(aid)
        seen_ids.add(aid)

        if aid != f"{shell}-{num}":
            id_errors.append(f"{aid}: shell={shell} arr={num}")
        if code in rules.SHELL_SIZE_NUMBERS and rules.SHELL_SIZE_NUMBERS[code] != shell:
            shell_errors.append(f"{aid}: code {code}->{rules.SHELL_SIZE_NUMBERS.get(code)} != shell {shell}")

        if a.get("contact_count") != len(contacts):
            count_errors.append(f"{aid}: contact_count={a.get('contact_count')} actual={len(contacts)}")
        if a.get("expected_contact_count") not in (None, len(contacts)):
            count_errors.append(f"{aid}: expected={a.get('expected_contact_count')} actual={len(contacts)}")

        labels = [c.get("label") for c in contacts]
        if any(lbl in (None, "", "?") for lbl in labels):
            label_errors.append(f"{aid}: empty/'?' label present")
        if len(labels) != len(set(labels)):
            label_errors.append(f"{aid}: duplicate labels")

        for c in contacts:
            if c.get("x") is None or c.get("y") is None:
                coord_errors.append(f"{aid}:{c.get('label')}")
            if str(c.get("size")) not in rating_sizes:
                size_errors.append(f"{aid}:{c.get('label')} size={c.get('size')!r}")

    rep.check(not dup_ids, "arrangement ids are unique" + (f" ({dup_ids})" if dup_ids else ""))
    rep.check(not id_errors, "every id == 'shell-arrangement'" + (f" ({id_errors[:3]})" if id_errors else ""))
    rep.check(not shell_errors, "shell_size matches shell_size_code (Table I)" + (f" ({shell_errors[:3]})" if shell_errors else ""))
    rep.check(not count_errors, "contact counts are self-consistent" + (f" ({count_errors[:3]})" if count_errors else ""))
    rep.check(not label_errors, "pin labels unique and non-empty per arrangement" + (f" ({label_errors[:3]})" if label_errors else ""))
    rep.check(not coord_errors, "every contact has x/y coordinates" + (f" ({len(coord_errors)} missing)" if coord_errors else ""))
    rep.check(not size_errors,
              "every contact size has a current rating"
              + (f" ({len(size_errors)} unrated, e.g. {sorted(set(size_errors))[:3]})" if size_errors else ""))


# --------------------------------------------------------------------------- #
# Group D — conversions
# --------------------------------------------------------------------------- #

def validate_converter_rules(rep: Report) -> None:
    """Static check that the converter rule table only references known fields."""
    known_classes = set(rules.KNOWN_CLASSES)
    known_shell_types = set(rules.MIL_SHELL_TYPES)
    valid_keys_by_series = standard_keys_by_series()
    bad_class: list[str] = []
    bad_shell: list[str] = []
    bad_contact: list[str] = []
    bad_key: list[str] = []
    bad_format: list[str] = []
    valid_formats = {"amphenol_prefix", "conesys", "eaton", "glenair", "itt", "souriau", "te_dts", "te_act"}

    for rule in rules.RULES:
        line = rule["product_line"]
        series = rule["series"]
        if rule["format"] not in valid_formats:
            bad_format.append(f"{line}: {rule['format']}")
        for st in rule["styles"]:
            if st not in known_shell_types:
                bad_shell.append(f"{line}: /{st}")
        classes: set[str] = set()
        if rule["format"] == "amphenol_prefix":
            for body in rule["styles"].values():
                classes.update(body.get("prefix_by_finish", {}).keys())
        elif "supported_finishes" in rule:
            classes.update(rule["supported_finishes"])
        elif "finishes" in rule:
            classes.update(rule["finishes"].keys())
        for cls in classes:
            if cls not in known_classes:
                bad_class.append(f"{line}: {cls}")
        for c in rule.get("supported_contacts", []):
            if c not in rules.CONTACT_DESCRIPTIONS and c not in {"R", "M", "G", "U"}:
                bad_contact.append(f"{line}: {c}")
        valid_keys = valid_keys_by_series.get(series, set("NABCDE"))
        for k in rule.get("supported_keys", []):
            if k not in valid_keys:
                bad_key.append(f"{line} (Series {series}): {k}")

    rep.check(not bad_format, "every converter rule has a known format" + (f" ({bad_format})" if bad_format else ""))
    rep.check(not bad_shell, "every converter rule shell type is known" + (f" ({bad_shell[:5]})" if bad_shell else ""))
    rep.check(not bad_class, "every converter rule class is a KNOWN_CLASS" + (f" ({bad_class[:5]})" if bad_class else ""))
    rep.check(not bad_contact, "every converter rule contact is known" + (f" ({bad_contact[:5]})" if bad_contact else ""))
    rep.check(not bad_key,
              "every converter rule key is a valid polarization for its series"
              + (f" ({bad_key[:8]})" if bad_key else ""))


def run_subtest(rep: Report, label: str, argv: list[str], *, warn_on_missing: bool = False) -> None:
    try:
        proc = subprocess.run([sys.executable, *argv], cwd=ROOT,
                              capture_output=True, text=True, timeout=900)
    except Exception as exc:  # noqa: BLE001
        rep.check(False, f"{label} run failed to launch: {exc}", warn=warn_on_missing)
        return
    ok = proc.returncode == 0
    detail = ""
    if not ok:
        tail = (proc.stdout or "").strip().splitlines()[-4:]
        detail = " | " + " / ".join(tail) if tail else f" (exit {proc.returncode})"
    rep.check(ok, f"{label} passes" + detail, warn=warn_on_missing)


def validate_conversions(rep: Report, skip_roundtrip: bool, roundtrip_limit: int) -> None:
    rep.group("D. Conversions (forward + reverse round-trip)")
    validate_converter_rules(rep)
    if skip_roundtrip:
        rep.check(True, "round-trip subtests skipped (--skip-roundtrip)", warn=True)
        return
    run_subtest(rep, "curated converter round-trip", ["scripts/converter_roundtrip_test.py"])
    run_subtest(rep, "manufacturer catalog smoke (Python/JS parity)",
                ["scripts/manufacturer_catalog_smoke_test.py"])
    run_subtest(rep, f"exhaustive round-trip (limit {roundtrip_limit})",
                ["scripts/exhaustive_roundtrip_test.py", "--limit", str(roundtrip_limit), "--quiet"])


# --------------------------------------------------------------------------- #
# Group E — technical-spec cross-consistency
# --------------------------------------------------------------------------- #

def validate_technical_specs(rep: Report) -> None:
    rep.group("E. Technical-spec cross-consistency")
    std = read_json("standard_definitions.json")["definitions"]
    pnr = read_json("part_number_rules.json")["definitions"]

    # E1. Shell-size codes: standard_definitions vs part_number_rules vs d38999_rules.
    std_shell = {code: body["shell_size"] for code, body in std["shell_size_codes_series_iii_iv"].items()}
    pnr_shell = {code: body["shell_size"] for code, body in pnr["shell_size_codes_series_iii_iv"].items()}
    rep.check(std_shell == rules.SHELL_SIZE_NUMBERS,
              "shell-size codes: standard_definitions == d38999_rules.SHELL_SIZE_NUMBERS"
              + (f" (diff {set(std_shell.items()) ^ set(rules.SHELL_SIZE_NUMBERS.items())})"
                 if std_shell != rules.SHELL_SIZE_NUMBERS else ""))
    rep.check(std_shell == pnr_shell,
              "shell-size codes: standard_definitions == part_number_rules")

    # E2. Contact styles: standard_definitions vs part_number_rules.
    std_contacts = set(std["contact_styles"].keys())
    pnr_contacts = set(pnr["contact_styles"].keys())
    rep.check(std_contacts == pnr_contacts,
              "contact styles: standard_definitions == part_number_rules"
              + (f" (diff {std_contacts ^ pnr_contacts})" if std_contacts != pnr_contacts else ""))
    # Genders agree with the converter's pin/socket understanding where both define one.
    gender_conflicts = []
    for code, body in std["contact_styles"].items():
        g = body.get("contact_gender")
        desc = rules.CONTACT_DESCRIPTIONS.get(code, "")
        if g == "pin" and desc and "ocket" in desc:
            gender_conflicts.append(code)
        if g == "socket" and desc and desc.strip().lower().startswith("pin"):
            gender_conflicts.append(code)
    rep.check(not gender_conflicts,
              "contact gender agrees between standard_definitions and d38999_rules"
              + (f" ({gender_conflicts})" if gender_conflicts else ""))

    # E3. Classes: standard_definitions vs part_number_rules (extracted pair must match).
    std_classes = set(std["classes"].keys())
    pnr_classes = set(pnr["classes"].keys())
    rep.check(std_classes == pnr_classes,
              "classes: standard_definitions == part_number_rules"
              + (f" (diff {std_classes ^ pnr_classes})" if std_classes != pnr_classes else ""))
    # Converter KNOWN_CLASSES is allowed to be a documented superset of the
    # extracted standard table, but must never be missing one of them.
    missing = std_classes - set(rules.KNOWN_CLASSES)
    rep.check(not missing,
              "every standard_definitions class is a converter KNOWN_CLASS"
              + (f" (missing {missing})" if missing else ""))
    extra = set(rules.KNOWN_CLASSES) - std_classes
    rep.check(not extra,
              f"converter KNOWN_CLASSES adds no class beyond standard_definitions (superset: {sorted(extra)})",
              warn=True)

    # E4. Keying letters: Series III exposes N + A..E on every shell size; the
    # converter's per-series key sets must stay within the MIL-spec sets.
    rot = std["polarization"]["series_iii"]["rotations_by_shell_size"]
    key_errors = []
    for shell, letters in rot.items():
        if set(letters.keys()) != set("NABCDE"):
            key_errors.append(f"{shell}: {sorted(letters.keys())}")
    rep.check(not key_errors,
              "every Series III shell size defines keying letters N,A,B,C,D,E"
              + (f" ({key_errors[:3]})" if key_errors else ""))

    valid_keys = standard_keys_by_series()
    converter_keys: dict[str, set[str]] = {"III": set(), "IV": set()}
    for rule in rules.RULES:
        converter_keys.setdefault(rule["series"], set()).update(rule.get("supported_keys", []))
    for series in ("III", "IV"):
        extra_keys = converter_keys.get(series, set()) - valid_keys.get(series, set())
        rep.check(not extra_keys,
                  f"converter Series {series} keying stays within MIL-spec set "
                  f"{sorted(valid_keys.get(series, set()))}"
                  + (f" (extra {sorted(extra_keys)})" if extra_keys else ""))

    # E5. The valid-PN builder's canonical decoder must agree with the converter's
    # parser on representative Series III/IV PNs, including double-letter classes
    # that use an optional hyphen in the published part number.
    builder_decode_mismatches = []
    for pn in (
        "D38999/26WE35PN",
        "D38999/26AAE35PN",
        "D38999/26AA-E35PN",
        "D38999/46ABE35PN",
        "D38999/46AB-E35PN",
    ):
        parsed = rules.parse_d38999_pin(pn)
        decoded = valid_pn_builder_decode_part_number(pn) or {}
        expected = {
            "slashSheet": f"/{parsed.shell_type}",
            "class": parsed.service_class,
            "shellSizeCode": parsed.shell_size_code,
            "insertArrangement": parsed.insert,
            "contactStyle": parsed.contact,
            "keying": parsed.key,
        }
        mismatched = [
            f"{field}={decoded.get(field)!r} expected {value!r}"
            for field, value in expected.items()
            if str(decoded.get(field, "")).upper() != str(value).upper()
        ]
        if mismatched:
            builder_decode_mismatches.append(f"{pn}: {', '.join(mismatched)}")
    rep.check(
        not builder_decode_mismatches,
        "valid-PN builder parser matches canonical parser for representative Series III/IV PNs"
        + (f" ({builder_decode_mismatches[:3]})" if builder_decode_mismatches else ""),
    )

    # E6. Current ratings: overlapping sizes agree across both rating tables.
    ccr = {str(r["contact_size"]): r for r in read_json("contact_current_ratings.json")["ratings"]}
    eng = read_json("connector_engineering_reference.json")["contact_current_ratings"]["ratings"]
    amp_conflicts = []
    awg_conflicts = []
    for size, body in eng.items():
        if size in ccr:
            if float(ccr[size]["current_amps"]) != float(body["amps"]):
                amp_conflicts.append(f"{size}: {ccr[size]['current_amps']} vs {body['amps']}")
            # contact_current_ratings stores an AWG range; the engineering table a
            # single representative gauge that must fall within that range.
            lo, hi = ccr[size]["wire_awg_min"], ccr[size]["wire_awg_max"]
            if not (lo <= body["wire_gauge_awg"] <= hi):
                awg_conflicts.append(f"{size}: {body['wire_gauge_awg']} not in {lo}-{hi}")
    rep.check(not amp_conflicts,
              "overlapping contact current ratings agree on amps"
              + (f" ({amp_conflicts})" if amp_conflicts else ""))
    rep.check(not awg_conflicts,
              "engineering-table wire gauge falls in the rating AWG range"
              + (f" ({awg_conflicts})" if awg_conflicts else ""))

    # E7. Series definitions cover the slash-sheet shell types in use.
    series_keys = set(read_json("standard_definitions.json")["definitions"]["series"].keys())
    used_series = set(rules.SERIES_BY_SHELL_TYPE.values())
    rep.check(used_series <= series_keys,
              "every series used by shell types is defined in standard_definitions"
              + (f" (missing {used_series - series_keys})" if not used_series <= series_keys else ""))


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--strict", action="store_true",
                    help="Treat WARN findings as failures.")
    ap.add_argument("--skip-roundtrip", action="store_true",
                    help="Skip the Node-backed round-trip subtests (Group D).")
    ap.add_argument("--roundtrip-limit", type=int, default=1500,
                    help="Sample size for the exhaustive round-trip subtest.")
    args = ap.parse_args()

    rep = Report()
    validate_bundle_parity(rep)
    validate_part_numbers(rep)
    validate_arrangements(rep)
    validate_conversions(rep, args.skip_roundtrip, args.roundtrip_limit)
    validate_technical_specs(rep)

    print("\n" + "=" * 60)
    print(f"SUMMARY: {rep.passes} passed, {len(rep.warns)} warnings, {len(rep.fails)} failures")
    if rep.warns:
        print("\nWarnings:")
        for w in rep.warns:
            print(f"  WARN  {w}")
    if rep.fails:
        print("\nFailures:")
        for f in rep.fails:
            print(f"  FAIL  {f}")

    failed = bool(rep.fails) or (args.strict and bool(rep.warns))
    print("\nRESULT:", "FAIL" if failed else "PASS")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
