"""Re-validation reconcile report for the QPL-1122 crawl.

Compares the freshly crawled QPL-1122 part set against the previously committed
list and confirms that every part still decodes with the same grammar that
``build_valid_d38999_pns.py`` uses.  The report is read-only: it never mutates
curated data.  Anything that fails to decode is surfaced here (it would
otherwise be silently dropped by the validator) so a human can decide whether a
new slash-sheet / format needs decoder support.

Outputs ``data/qpl_1122_revalidation_report.json`` and prints a summary.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_valid_d38999_pns import (  # noqa: E402  (path set above)
    canonical_part_number,
    decode_part_number,
    is_d38999_part_number,
    normalize_part_number,
)

DEFAULT_DETAILS = DATA_DIR / "qpl_1122_part_details.json"
DEFAULT_REPORT = DATA_DIR / "qpl_1122_revalidation_report.json"
LIST_REL_PATH = "data/qpl_1122_part_numbers.json"
SAMPLE_CAP = 200


def load_new_parts(details_path: Path) -> list[dict[str, object]]:
    payload = json.loads(details_path.read_text(encoding="utf-8"))
    return payload.get("parts", [])


def old_part_numbers(ref: str) -> set[str] | None:
    """Return the normalized PN set from the committed list at a git ref."""
    try:
        result = subprocess.run(
            ["git", "show", f"{ref}:{LIST_REL_PATH}"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as error:
        print(f"warning: could not read old list from git ({error})", file=sys.stderr)
        return None
    payload = json.loads(result.stdout)
    return {normalize_part_number(pn) for pn in payload.get("part_numbers", [])}


def build_report(details_path: Path, ref: str) -> dict[str, object]:
    parts = load_new_parts(details_path)
    new_norm: set[str] = set()
    undecodable: list[str] = []
    slash_sheets: Counter[str] = Counter()
    cage_counts: Counter[str] = Counter()
    company_by_cage: dict[str, str] = {}
    qualified = 0
    unqualified: list[str] = []

    for entry in parts:
        raw_pn = str(entry.get("partNumber", ""))
        canonical = canonical_part_number(raw_pn)
        new_norm.add(normalize_part_number(canonical))
        if is_d38999_part_number(canonical):
            decoded = decode_part_number(canonical) or {}
            slash_sheets[str(decoded.get("slashSheet", "?"))] += 1
        else:
            undecodable.append(canonical)
        sources = entry.get("qualifiedSources") or []
        if sources:
            qualified += 1
        else:
            unqualified.append(canonical)
        for src in sources:
            cage = str(src.get("cage", "")).strip()
            if cage:
                cage_counts[cage] += 1
                company_by_cage.setdefault(cage, str(src.get("company", "")).strip())

    old_norm = old_part_numbers(ref)
    added = sorted(new_norm - old_norm) if old_norm is not None else []
    removed = sorted(old_norm - new_norm) if old_norm is not None else []

    top_sources = [
        {"cage": cage, "company": company_by_cage.get(cage, ""), "partCount": count}
        for cage, count in cage_counts.most_common(25)
    ]

    return {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "detailsFile": details_path.name,
        "comparedAgainst": f"git {ref}:{LIST_REL_PATH}" if old_norm is not None else None,
        "counts": {
            "newUniqueParts": len(new_norm),
            "oldUniqueParts": len(old_norm) if old_norm is not None else None,
            "added": len(added),
            "removed": len(removed),
            "undecodable": len(undecodable),
            "withQualifiedSource": qualified,
            "withoutQualifiedSource": len(unqualified),
            "distinctSlashSheets": len(slash_sheets),
            "distinctCageCodes": len(cage_counts),
        },
        "slashSheetCounts": dict(sorted(slash_sheets.items(), key=lambda kv: kv[0])),
        "undecodablePartNumbers": sorted(undecodable),
        "topQualifiedSources": top_sources,
        "addedSample": added[:SAMPLE_CAP],
        "removedSample": removed[:SAMPLE_CAP],
        "withoutQualifiedSourceSample": sorted(unqualified)[:SAMPLE_CAP],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--details", type=Path, default=DEFAULT_DETAILS)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--ref", default="HEAD", help="git ref for the previous list.")
    args = parser.parse_args()

    if not args.details.exists():
        print(f"error: {args.details} not found (run the crawl first).", file=sys.stderr)
        return 1

    report = build_report(args.details, args.ref)
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    counts = report["counts"]
    print(f"Re-validation report written to {args.report}")
    print(f"  new unique parts:        {counts['newUniqueParts']}")
    print(f"  old unique parts:        {counts['oldUniqueParts']}")
    print(f"  added / removed:         {counts['added']} / {counts['removed']}")
    print(f"  undecodable:             {counts['undecodable']}")
    print(f"  with qualified source:   {counts['withQualifiedSource']}")
    print(f"  without qualified source:{counts['withoutQualifiedSource']}")
    print(f"  distinct slash sheets:   {counts['distinctSlashSheets']}")
    if report["undecodablePartNumbers"]:
        preview = ", ".join(report["undecodablePartNumbers"][:10])
        print(f"  undecodable preview:     {preview}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
