#!/usr/bin/env python3
"""
Comprehensive offline smoke test for every connector the d38999 Toolbox knows
about: standard MIL-DTL-38999 insert-arrangement part numbers AND the
D38999-style rugged I/O families (RJ45 / USB / USB-C / HDMI / DisplayPort etc.).

It runs with the Python standard library only (no Node, no browser) by:
  * parsing the canonical ``RUGGED_IO_FAMILIES`` table directly out of
    ``app/converter.js`` and faithfully re-implementing ``recognizeRuggedIo``,
  * cross-checking every rugged family + every verified manufacturer part
    number against the catalog JSON and the front-face SVG assets,
  * validating the standard D38999 part-number corpus against the published
    regex and the source-defined code tables,
  * verifying that catalog-supported combinations are internally consistent and
    that the valid part-number corpus never violates a catalog combination.

Exit code is non-zero if any check fails, so it doubles as CI.

Usage:
    python3 scripts/smoke_test_connectors.py            # standard run
    python3 scripts/smoke_test_connectors.py --full     # validate ALL 7750 PNs
    python3 scripts/smoke_test_connectors.py --quiet     # only summary + failures
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
APP = ROOT / "app"
SRC_SVG = ROOT / "assets" / "d38999" / "svg"
APP_SVG = APP / "assets" / "d38999" / "svg"

STD_PN_SAMPLE = 600  # number of standard PNs validated unless --full


# --------------------------------------------------------------------------- #
# Tiny report helpers
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


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------- #
# Parse RUGGED_IO_FAMILIES + re-implement recognizeRuggedIo from converter.js
# --------------------------------------------------------------------------- #
def parse_rugged_families(converter_js: Path) -> list[dict]:
    text = converter_js.read_text(encoding="utf-8")
    m = re.search(r"const RUGGED_IO_FAMILIES\s*=\s*\[(.*?)\];", text, re.DOTALL)
    if not m:
        raise RuntimeError("Could not locate RUGGED_IO_FAMILIES in converter.js")
    body = m.group(1)
    entries: list[dict] = []
    obj_re = re.compile(r"\{([^{}]*)\}")
    field_re = re.compile(r'(\w+)\s*:\s*"([^"]*)"')
    for obj in obj_re.finditer(body):
        fields = dict(field_re.findall(obj.group(1)))
        if "prefix" in fields:
            entries.append(fields)
    return entries


SHELL_TYPE_MAP = {
    "6": ("Plug", "plug"),
    "7": ("Jam Nut Receptacle", "jam-nut-receptacle"),
    "2": ("Square Flange Receptacle", "square-flange-receptacle"),
}


def _norm(s: str) -> str:
    return re.sub(r"[\s-]+", "", s).upper()


def recognize_rugged(value: str, families: list[dict]) -> dict | None:
    """Faithful port of recognizeRuggedIo() prefix matching (array order)."""
    cleaned = re.sub(r"^D38999/", "", value or "", flags=re.IGNORECASE)
    upper = _norm(cleaned)
    for entry in families:
        prefix = _norm(entry["prefix"])
        if upper.startswith(prefix):
            suffix = cleaned[len(entry["prefix"]):].lstrip(" -")
            shell_char = suffix[:1]
            mount = SHELL_TYPE_MAP.get(shell_char, ("", ""))[0]
            return {
                "recognized": True,
                "matched_prefix": entry["prefix"],
                "family": entry["family"],
                "vendor": entry["vendor"],
                "interface": entry["interface"],
                "shell_size": entry["shellSize"],
                "svg": entry["svg"],
                "mounting_type": mount,
            }
    return None


# --------------------------------------------------------------------------- #
# Section A — rugged families integrity + SVG assets
# --------------------------------------------------------------------------- #
def section_rugged_families(rep: Report, families: list[dict]) -> None:
    rep.section("A. Rugged I/O families (converter.js)")
    passed = 0
    required = {"prefix", "family", "vendor", "interface", "shellSize", "relation", "svg"}
    for e in families:
        label = f"{e.get('family','?')} [{e.get('prefix','?')}]"
        missing = required - e.keys()
        if missing:
            rep.fail(f"{label}: missing fields {sorted(missing)}")
            continue
        if not e["svg"]:
            rep.fail(f"{label}: empty svg")
            continue
        src = SRC_SVG / e["svg"]
        built = APP_SVG / e["svg"]
        if not src.exists():
            rep.fail(f"{label}: source SVG missing ({src.relative_to(ROOT)})")
            continue
        if not built.exists():
            rep.fail(f"{label}: built SVG missing ({built.relative_to(ROOT)}) — run build_app.py")
            continue
        rec = recognize_rugged(e["prefix"], families)
        if not rec:
            rep.fail(f"{label}: prefix not self-recognized")
            continue
        if rec["family"] != e["family"]:
            rep.fail(f"{label}: prefix resolves to family {rec['family']!r}, shadowed by earlier entry")
            continue
        passed += 1
    rep.ok(f"{passed}/{len(families)} rugged families valid with present SVG assets")
    rep.tally("A rugged families", passed, len(families))


# --------------------------------------------------------------------------- #
# Section B — verified manufacturer rugged P/Ns
# --------------------------------------------------------------------------- #
def collect_verified_rugged_pns(node: object, acc: list[tuple[str, str, str]], fam: str = "") -> None:
    if isinstance(node, dict):
        this_fam = node.get("family") or node.get("series") or fam
        for item in node.get("verified_purchasable_pns", []) or []:
            pn = item.get("pn") if isinstance(item, dict) else item
            desc = item.get("description", "") if isinstance(item, dict) else ""
            if pn:
                acc.append((pn, this_fam, desc))
        for v in node.values():
            collect_verified_rugged_pns(v, acc, this_fam)
    elif isinstance(node, list):
        for v in node:
            collect_verified_rugged_pns(v, acc, fam)


def base_number(pn: str) -> str:
    m = re.match(r"^(\d{3}-\d{3})", pn)
    return m.group(1) if m else ""


def section_verified_rugged(rep: Report, families: list[dict], rugged_json: dict) -> None:
    rep.section("B. Verified manufacturer rugged P/Ns vs catalog")
    pns: list[tuple[str, str, str]] = []
    collect_verified_rugged_pns(rugged_json, pns)
    prefixes = {_norm(e["prefix"]) for e in families}
    passed = 0
    for pn, fam, _desc in pns:
        rec = recognize_rugged(pn, families)
        if not rec:
            rep.fail(f"{pn} ({fam}): NOT recognized by any rugged family")
            continue
        base = base_number(pn)
        if base and _norm(rec["matched_prefix"]) != _norm(base):
            # PN matched a different series than its own base number -> wrong shape
            if _norm(base) in prefixes:
                rep.fail(f"{pn}: matched {rec['matched_prefix']} but base {base} is a distinct catalog series")
                continue
            rep.warn(f"{pn}: base {base} not in family table; matched {rec['matched_prefix']}")
        if not (APP_SVG / rec["svg"]).exists():
            rep.fail(f"{pn}: front-face SVG {rec['svg']} missing")
            continue
        passed += 1
    rep.ok(f"{passed}/{len(pns)} verified rugged P/Ns recognized + mapped to correct series & SVG")
    rep.tally("B verified rugged PNs", passed, len(pns))


# --------------------------------------------------------------------------- #
# Section C — standard D38999 valid part numbers
# --------------------------------------------------------------------------- #
# Slash sheets whose part numbers intentionally use a NON insert-arrangement
# field order (caps, dummy receptacles, covers). These are validated for
# structural self-consistency, not against the insert-arrangement regex.
ACCESSORY_SHEETS = {"/22", "/32", "/33", "/50", "/51", "/52"}


def section_standard_pns(rep: Report, rules: dict, valid: dict, full: bool) -> None:
    rep.section("C. Standard D38999 valid part numbers")
    patterns = rules.get("part_number_patterns", [])
    if not patterns:
        rep.fail("no part_number_patterns in part_number_rules.json")
        return
    regex = re.compile(patterns[0]["regex"])
    defs = rules.get("definitions", {})
    shell_codes = set(defs.get("shell_size_codes_series_iii_iv", {}))
    classes = set(defs.get("classes", {}))
    contacts = set(defs.get("contact_styles", {}))

    parts = valid.get("partNumbers", [])
    subset = parts if full else parts[:STD_PN_SAMPLE]
    passed = 0
    n_insert = n_accessory = n_variant = 0
    unknown_contacts: dict[str, int] = {}
    accessory_shell_notes: dict[str, int] = {}
    sheet_re = re.compile(r"^D38999(/\d{2})")
    for p in subset:
        pn = p.get("normalizedPartNumber") or p.get("partNumber")
        dec = p.get("decoded", {}) or {}
        # leading slash sheet must match the decoded slash sheet
        sm = sheet_re.match(pn or "")
        if not sm:
            rep.fail(f"{pn}: not a D38999/NN part number")
            continue
        lead_sheet = sm.group(1)
        if dec.get("slashSheet") and dec["slashSheet"] != lead_sheet:
            rep.fail(f"{pn}: leading {lead_sheet} != decoded slashSheet {dec['slashSheet']}")
            continue

        m = regex.match(pn)
        is_variant = bool(dec.get("lanyardLengthCode") or dec.get("typeNumber"))
        is_accessory = lead_sheet in ACCESSORY_SHEETS

        if m and not is_accessory and not is_variant:
            # --- standard insert arrangement: full field validation ---
            n_insert += 1
            g_slash, g_class, g_shell, g_insert, g_contact, g_key = m.groups()
            class_letters = g_class.rstrip("-")
            problems = []
            if dec:
                if f"/{g_slash}" != dec.get("slashSheet"):
                    problems.append(f"slash {g_slash}!={dec.get('slashSheet')}")
                if class_letters != dec.get("class"):
                    problems.append(f"class {class_letters}!={dec.get('class')}")
                if g_shell != dec.get("shellSizeCode"):
                    problems.append(f"shell {g_shell}!={dec.get('shellSizeCode')}")
                if g_contact != dec.get("contactStyle"):
                    problems.append(f"contact {g_contact}!={dec.get('contactStyle')}")
                if g_key != dec.get("keying"):
                    problems.append(f"key {g_key}!={dec.get('keying')}")
            if g_shell not in shell_codes:
                problems.append(f"unknown shell code {g_shell}")
            if class_letters and class_letters not in classes:
                problems.append(f"unknown class {class_letters}")
            if contacts and g_contact not in contacts:
                unknown_contacts[g_contact] = unknown_contacts.get(g_contact, 0) + 1
            if problems:
                rep.fail(f"{pn}: " + "; ".join(problems))
                continue
            passed += 1
        else:
            # --- accessory / cap / dummy / variant: structural self-consistency ---
            if is_accessory:
                n_accessory += 1
                sc = dec.get("shellSizeCode")
                cls = dec.get("class")
                # Accessory shell-size tokens are a separate namespace (cap sizes);
                # non-standard tokens are recorded as a data note, not a failure.
                if sc and sc not in shell_codes:
                    accessory_shell_notes[sc] = accessory_shell_notes.get(sc, 0) + 1
                if cls and cls not in classes:
                    rep.fail(f"{pn} ({lead_sheet} accessory): unknown class {cls}")
                    continue
                passed += 1
            elif is_variant:
                n_variant += 1
                sc = dec.get("shellSizeCode")
                cls = dec.get("class")
                problems = []
                if sc and sc not in shell_codes:
                    problems.append(f"unknown shell code {sc}")
                if cls and cls not in classes:
                    problems.append(f"unknown class {cls}")
                if problems:
                    rep.fail(f"{pn} ({lead_sheet} variant): " + "; ".join(problems))
                    continue
                passed += 1
            else:
                # not accessory/variant yet failed the insert regex -> genuine problem
                rep.fail(f"{pn}: standard insert format expected but does not match published regex")
                continue

    if accessory_shell_notes:
        rep.warn(f"accessory cap-size tokens outside standard A-J namespace (expected): {accessory_shell_notes}")
    if unknown_contacts:
        rep.warn(f"contact styles not in definitions table (QPL coverage gap): {unknown_contacts} "
                 f"— extend definitions.contact_styles if these are confirmed valid")
    rep.ok(f"{passed}/{len(subset)} PNs valid "
           f"[insert={n_insert}, accessory/cap={n_accessory}, variant={n_variant}]"
           + ("" if full else f" (sample of {len(parts)})"))
    rep.tally("C standard PNs", passed, len(subset))


# --------------------------------------------------------------------------- #
# Section D — catalog supported combinations consistency
# --------------------------------------------------------------------------- #
def canonical_sheets(shell_style_code: str) -> list[str]:
    """Normalize a catalog ``shellStyleCode`` to canonical ``/NN`` slash sheets.

    The catalog mixes encodings: MIL-DTL rows use ``/20``; manufacturer rows use
    bare ``20`` / ``00``; the cap row combines several (``/32 / /33 / /51``).
    Two-or-more-digit groups map to a slash sheet; shorter manufacturer-specific
    style digits (e.g. Souriau ``0``/``7``/``5``) have no canonical slash sheet.
    """
    out: list[str] = []
    for tok in re.split(r"[\s/]+", shell_style_code or ""):
        tok = tok.strip()
        if len(tok) >= 2 and tok.isdigit():
            out.append(f"/{tok}")
    return out


def section_catalog(rep: Report, rules: dict, catalog: dict, valid: dict, full: bool) -> None:
    rep.section("D. Catalog supported combinations vs corpus")
    defs = rules.get("definitions", {})
    contacts = set(defs.get("contact_styles", {}))
    combos = catalog.get("catalogSupportedCombinations", [])

    # known slash sheets = explicit defs + every slash sheet present in the valid corpus
    known_sheets = set(defs.get("slash_sheets", {}))
    corpus_sheets = {p.get("decoded", {}).get("slashSheet") for p in valid.get("partNumbers", [])}
    corpus_sheets.discard(None)
    resolvable = known_sheets | corpus_sheets

    combo_index: dict[str, list[dict]] = {}
    passed = 0
    unresolved = 0
    for c in combos:
        code = c.get("shellStyleCode", "")
        label = f"{c.get('manufacturer','?')} {c.get('shellStyle','?')} [{code}]"
        bad_contacts = set(c.get("supportedContactStyles", [])) - contacts if contacts else set()
        if bad_contacts:
            rep.fail(f"{label}: unknown contact styles {sorted(bad_contacts)}")
            continue
        sheets = canonical_sheets(code)
        if not sheets:
            unresolved += 1  # manufacturer-specific single-digit style code
        else:
            for s in sheets:
                if s not in resolvable:
                    rep.warn(f"{label}: canonical {s} not in defs or corpus")
                combo_index.setdefault(s, []).append(c)
        passed += 1
    rep.ok(f"{passed}/{len(combos)} catalog combinations internally consistent"
           + (f" ({unresolved} manufacturer-specific style codes without a canonical slash sheet)" if unresolved else ""))
    rep.tally("D catalog combos", passed, len(combos))

    # Cross-check: corpus PNs must not violate ANY catalog combo for their shell style
    rep.section("D2. Corpus PNs honoring catalog contact/keying sets")
    parts = valid.get("partNumbers", [])
    subset = parts if full else parts[:STD_PN_SAMPLE * 4]
    checked = 0
    violations = 0
    for p in subset:
        dec = p.get("decoded", {})
        sheet = dec.get("slashSheet")
        combos_for = combo_index.get(sheet)
        if not combos_for:
            continue
        checked += 1
        # honored if the PN fits at least one catalog combo for this shell style
        ok = False
        for combo in combos_for:
            cs = combo.get("supportedContactStyles")
            ks = combo.get("supportedKeying")
            if cs and dec.get("contactStyle") not in cs:
                continue
            if ks and dec.get("keying") not in ks:
                continue
            ok = True
            break
        if not ok:
            example = combos_for[0]
            rep.fail(f"{p.get('partNumber')}: contact {dec.get('contactStyle')}/key {dec.get('keying')} "
                     f"not supported by any catalog combo for {sheet} "
                     f"(e.g. contacts {example.get('supportedContactStyles')}, keys {example.get('supportedKeying')})")
            violations += 1
    rep.ok(f"{checked - violations}/{checked} catalog-covered PNs honor a supported contact/keying combo")
    rep.tally("D2 corpus vs catalog", checked - violations, checked)


# --------------------------------------------------------------------------- #
# Section E — verified manufacturer standard P/Ns parse cleanly
# --------------------------------------------------------------------------- #
def section_verified_standard(rep: Report, rules: dict, verified: object) -> None:
    rep.section("E. Verified manufacturer standard P/Ns")
    regex = re.compile(rules["part_number_patterns"][0]["regex"])
    pns: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                if k in ("partNumber", "part_number", "pn") and isinstance(v, str) and v.startswith("D38999/"):
                    pns.append(v)
                else:
                    walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(verified)
    pns = sorted(set(pns))
    if not pns:
        rep.warn("no standard D38999 part numbers found in verified source")
        rep.tally("E verified standard PNs", 0, 0)
        return
    passed = sum(1 for pn in pns if regex.match(pn))
    for pn in pns:
        if not regex.match(pn):
            rep.fail(f"{pn}: verified standard PN fails regex")
    rep.ok(f"{passed}/{len(pns)} verified standard P/Ns match published regex")
    rep.tally("E verified standard PNs", passed, len(pns))


# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--full", action="store_true", help="validate the entire PN corpus, not a sample")
    ap.add_argument("--quiet", action="store_true", help="print only the summary and failures")
    args = ap.parse_args()

    rep = Report(args.quiet)
    print("d38999 Toolbox — connector smoke test")
    print(f"root: {ROOT}")

    families = parse_rugged_families(APP / "converter.js")
    rugged_json = load_json(DATA / "rugged_io_d38999_style_connectors.json")
    rules = load_json(DATA / "part_number_rules.json")
    valid = load_json(DATA / "d38999_valid_part_numbers.json")
    catalog = load_json(DATA / "d38999_catalog_supported_combinations.json")
    verified = load_json(DATA / "d38999_verified_part_numbers.json")

    section_rugged_families(rep, families)
    section_verified_rugged(rep, families, rugged_json)
    section_standard_pns(rep, rules, valid, args.full)
    section_catalog(rep, rules, catalog, valid, args.full)
    section_verified_standard(rep, rules, verified)

    print("\n=== SUMMARY ===")
    for title, passed, total in rep.sections:
        flag = "OK " if passed == total else "BAD"
        print(f"  [{flag}] {title}: {passed}/{total}")
    print(f"\n  warnings: {len(rep.warnings)}")
    print(f"  failures: {len(rep.failures)}")
    if rep.failures:
        print("\nFAILED — see FAIL lines above.")
        return 1
    print("\nALL CHECKS PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
