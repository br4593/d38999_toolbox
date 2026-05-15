from __future__ import annotations

import argparse
import csv
import json
import sys

from d38999_rules import convert_pin


def print_table(result: dict) -> None:
    decoded = result["decoded"]
    print(f"Input:      {result['input']}")
    print(f"Normalized: {result['normalized']}")
    print(
        "Decoded:    "
        f"Series {decoded['series']}, /{decoded['shell_type']} {decoded['shell_type_description']}, "
        f"class {decoded['service_class']}, shell {decoded['shell_size_code']}={decoded['shell_size_number']}, "
        f"insert {decoded['insert']}, contact {decoded['contact']}, key {decoded['key']}"
    )
    print()

    if not result["candidates"]:
        print("No automated manufacturer candidates found in the current rule database.")
        return

    rows = result["candidates"]
    widths = {
        "manufacturer": max(len("Manufacturer"), *(len(row["manufacturer"]) for row in rows)),
        "product_line": max(len("Product line"), *(len(row["product_line"]) for row in rows)),
        "manufacturer_part_number": max(len("Manufacturer PN"), *(len(row["manufacturer_part_number"]) for row in rows)),
        "confidence": max(len("Confidence"), *(len(row["confidence"]) for row in rows)),
    }
    header = (
        f"{'Manufacturer':<{widths['manufacturer']}}  "
        f"{'Product line':<{widths['product_line']}}  "
        f"{'Manufacturer PN':<{widths['manufacturer_part_number']}}  "
        f"{'Confidence':<{widths['confidence']}}"
    )
    print(header)
    print("-" * len(header))
    for row in rows:
        print(
            f"{row['manufacturer']:<{widths['manufacturer']}}  "
            f"{row['product_line']:<{widths['product_line']}}  "
            f"{row['manufacturer_part_number']:<{widths['manufacturer_part_number']}}  "
            f"{row['confidence']:<{widths['confidence']}}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert a D38999 PIN to manufacturer catalog part numbers.")
    parser.add_argument("pin", help="Example: D38999/26WD35PN")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of a text table")
    parser.add_argument("--csv", action="store_true", help="Print candidate rows as CSV")
    parser.add_argument("--include-unsupported", action="store_true", help="Include unsupported rule reasons in JSON")
    args = parser.parse_args()

    try:
        result = convert_pin(args.pin, include_unsupported=args.include_unsupported)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(result, indent=2))
    elif args.csv:
        writer = csv.DictWriter(
            sys.stdout,
            fieldnames=["manufacturer", "product_line", "manufacturer_part_number", "confidence", "notes"],
        )
        writer.writeheader()
        writer.writerows(result["candidates"])
    else:
        print_table(result)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

