#!/usr/bin/env python3
"""
Mouser API smoke test for D38999 part numbers.

Checks whether P/Ns that the toolbox can build/generate are actually
listed in the Mouser catalog.  Calls the Mouser Search API v2
(POST /api/v2/search/keyword) for each P/N and prints a summary table.

Usage:
    python3 scripts/mouser_smoke_test.py --key YOUR_API_KEY

The key can also be set via environment variable MOUSER_API_KEY.
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
from collections import defaultdict

# ---------------------------------------------------------------------------
# Test matrix
# ---------------------------------------------------------------------------
# Shell size codes  (TABLE I of MIL-DTL-38999)
SHELL_SIZE_CODES = {
    "A": 9, "B": 11, "C": 13, "D": 15,
    "E": 17, "F": 19, "G": 21, "H": 23, "J": 25,
}

# Arrangement number "35" exists for every shell size → safest baseline
# We also spot-check a size-specific one per class
COMMON_ARR = "35"

# Slash-sheet groups
HERMETIC_TYPES = {"21", "23", "25", "27", "41", "43", "45", "48"}

TEST_CASES = [
    # ── user's reported problem ──────────────────────────────────────────
    ("D38999/23SD5ZC",  "user-reported", "hermetic /23, class S, size D arr 5"),

    # ── Series III non-hermetic ─────────────────────────────────────────
    ("D38999/20WE35PN",  "/20 wall-mount",       "receptacle, pin, class W"),
    ("D38999/20WE35SN",  "/20 wall-mount",       "receptacle, socket, class W"),
    ("D38999/20NE35PN",  "/20 wall-mount",       "receptacle, pin, class N (CRES pass.)"),
    ("D38999/24WE35PN",  "/24 jam-nut",          "receptacle, pin, class W"),
    ("D38999/24WE35SN",  "/24 jam-nut",          "receptacle, socket, class W"),
    ("D38999/26WE35PN",  "/26 straight plug",    "plug, pin, class W"),
    ("D38999/26WE35SN",  "/26 straight plug",    "plug, socket, class W"),
    ("D38999/26NE35SN",  "/26 straight plug",    "plug, socket, class N"),
    ("D38999/26ZE35SN",  "/26 straight plug",    "plug, socket, class Z (Zn-Ni)"),
    ("D38999/26FE35SN",  "/26 straight plug",    "plug, socket, class F (OD cad)"),
    ("D38999/26TE35SN",  "/26 straight plug",    "plug, socket, class T"),

    # ── Series III hermetic (expect 0 or very few results) ───────────────
    ("D38999/21WE35PN",  "/21 hermetic box-mount",  "HERMETIC – should be rare"),
    ("D38999/23WE35PN",  "/23 hermetic jam-nut",    "HERMETIC – should be rare"),
    ("D38999/25WE35PN",  "/25 hermetic solder",     "HERMETIC – should be rare"),
    ("D38999/27WE35PN",  "/27 hermetic weld",       "HERMETIC – should be rare"),

    # ── Series III plug types (lanyard / right-angle) ────────────────────
    ("D38999/29WE35SN",  "/29 lanyard plug (pins)",   "lanyard, socket"),
    ("D38999/31WE35SN",  "/31 right-angle plug",      "right-angle, socket"),

    # ── Series IV non-hermetic ──────────────────────────────────────────
    ("D38999/40WE35PN",  "/40 wall-mount",          "Ser IV receptacle, pin"),
    ("D38999/42WE35PN",  "/42 box-mount",           "Ser IV receptacle, pin"),
    ("D38999/44WE35PN",  "/44 jam-nut",             "Ser IV receptacle, pin"),
    ("D38999/46WE35SN",  "/46 EMI plug",            "Ser IV EMI plug, socket"),
    ("D38999/47WE35SN",  "/47 non-EMI plug",        "Ser IV non-EMI plug, socket"),
    ("D38999/49WE35SN",  "/49 in-line",             "Ser IV in-line, socket"),

    # ── Series IV hermetic (expect 0 or very few) ───────────────────────
    ("D38999/41WE35PN",  "/41 hermetic box-mount",  "HERMETIC – should be rare"),
    ("D38999/43WE35PN",  "/43 hermetic jam-nut",    "HERMETIC – should be rare"),
    ("D38999/45WE35PN",  "/45 hermetic solder",     "HERMETIC – should be rare"),
    ("D38999/48WE35PN",  "/48 hermetic weld",       "HERMETIC – should be rare"),

    # ── Vary shell sizes (using /26, class W, arr 35, socket) ───────────
    ("D38999/26WA35SN",  "/26 shell A (9mm)",   "small shell"),
    ("D38999/26WC35SN",  "/26 shell C (13mm)",  ""),
    ("D38999/26WG35SN",  "/26 shell G (21mm)",  ""),
    ("D38999/26WJ35SN",  "/26 shell J (25mm)",  "large shell"),

    # ── Arrangement numbers that exist vs don't exist for size E (17mm) ─
    ("D38999/26WE2SN",   "/26 arr 2",   "valid arr for size 17"),
    ("D38999/26WE8SN",   "/26 arr 8",   "valid arr for size 17"),
    ("D38999/26WE22SN",  "/26 arr 22",  "valid arr for size 17"),
    ("D38999/26WE1SN",   "/26 arr 1",   "NOT a defined arrangement for any size"),
    ("D38999/26WE99SN",  "/26 arr 99",  "NOT defined for size 17"),
]

# ---------------------------------------------------------------------------
# Mouser API helper
# ---------------------------------------------------------------------------
MOUSER_URL = "https://api.mouser.com/api/v2/search/keyword"
RATE_LIMIT_SLEEP = 0.4   # seconds between requests


def mouser_search(api_key: str, keyword: str) -> dict:
    url = f"{MOUSER_URL}?apiKey={api_key}"
    payload = json.dumps({
        "SearchByKeywordRequest": {
            "keyword": keyword,
            "records": 10,
            "startingRecord": 0,
            "searchOptions": "",
            "searchWithYourSignUpLanguage": "",
        }
    }).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code, "_msg": e.reason}
    except Exception as e:
        return {"_error": str(e)}


def exact_matches(result: dict, keyword: str) -> list[str]:
    """Return ManufacturerPartNumbers that are an exact (case-insensitive) match."""
    parts = (result.get("SearchResults") or {}).get("Parts") or []
    kw_upper = keyword.upper()
    return [
        p.get("ManufacturerPartNumber", "")
        for p in parts
        if p.get("ManufacturerPartNumber", "").upper() == kw_upper
    ]


def any_matches(result: dict) -> int:
    return int((result.get("SearchResults") or {}).get("NumberOfResult") or 0)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Mouser API smoke test for D38999 P/Ns")
    parser.add_argument("--key", default=os.environ.get("MOUSER_API_KEY", ""),
                        help="Mouser Search API key (or set MOUSER_API_KEY env var)")
    parser.add_argument("--delay", type=float, default=RATE_LIMIT_SLEEP,
                        help="Seconds between requests (default 0.4)")
    args = parser.parse_args()

    if not args.key:
        sys.exit("Error: provide --key or set MOUSER_API_KEY environment variable")

    COL_PN   = 26
    COL_TYPE = 24
    COL_HIT  = 7
    COL_NOTE = 44
    header = (
        f"{'Part Number':<{COL_PN}} "
        f"{'Type':<{COL_TYPE}} "
        f"{'Results':>{COL_HIT}} "
        f"{'Note / first-hit MPN'}"
    )
    sep = "-" * (COL_PN + 1 + COL_TYPE + 1 + COL_HIT + 1 + COL_NOTE)

    print(header)
    print(sep)

    stats = defaultdict(list)          # "found" / "not_found" / "hermetic_found" / "error"

    for pn, type_label, note in TEST_CASES:
        is_hermetic = any(f"/{h}" in pn for h in HERMETIC_TYPES)

        result = mouser_search(args.key, pn)

        if "_http_error" in result or "_error" in result:
            hit_str = "ERR"
            detail  = result.get("_msg") or result.get("_error") or "unknown error"
            stats["error"].append(pn)
        else:
            n = any_matches(result)
            exact = exact_matches(result, pn)
            hit_str = str(n)
            if exact:
                detail = f"EXACT: {exact[0]}"
                stats["found"].append(pn)
            elif n > 0:
                first = (result["SearchResults"]["Parts"][0].get("ManufacturerPartNumber") or "")
                detail = f"partial: {first}"
                stats["found" if not is_hermetic else "hermetic_found"].append(pn)
            else:
                detail = note if note else "—"
                stats["not_found"].append(pn)
                if is_hermetic:
                    stats["hermetic_expected_absent"].append(pn)

        marker = ""
        if is_hermetic:
            marker = " [H]"

        print(
            f"{pn:<{COL_PN}}{marker[:4]:<4}"
            f"{type_label:<{COL_TYPE}} "
            f"{hit_str:>{COL_HIT}}  "
            f"{detail[:COL_NOTE]}"
        )
        time.sleep(args.delay)

    # summary
    print()
    print("=" * len(sep))
    print("SUMMARY")
    print("=" * len(sep))
    print(f"  Total tested        : {len(TEST_CASES)}")
    print(f"  Found on Mouser     : {len(stats['found'])}")
    print(f"  Not found           : {len(stats['not_found'])}")
    print(f"  Hermetic (absent as expected): {len(stats['hermetic_expected_absent'])}")
    print(f"  Hermetic (but found!): {len(stats['hermetic_found'])}")
    print(f"  Errors              : {len(stats['error'])}")

    if stats["not_found"]:
        print()
        print("NOT FOUND (non-hermetic):")
        non_h_missing = [p for p in stats["not_found"] if p not in stats["hermetic_expected_absent"]]
        for p in non_h_missing:
            print(f"  {p}")

    if stats["hermetic_found"]:
        print()
        print("WARNING – hermetic type found in catalog (unexpected):")
        for p in stats["hermetic_found"]:
            print(f"  {p}")


if __name__ == "__main__":
    main()
