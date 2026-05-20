from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DEFAULT_OUTPUT = DATA_DIR / "d38999_valid_part_numbers.json"

PART_NUMBER_RE = re.compile(
    r"^D38999/(?P<slashSheet>\d{2})(?P<class>[A-Z])(?P<shellSizeCode>[A-Z]{1,2})(?P<insertArrangement>\d{1,3})(?P<contactStyle>[A-Z])(?P<keying>[A-Z])$"
)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_part_number(part_number: str) -> str:
    return re.sub(r"[^A-Z0-9/]", "", (part_number or "").upper())


def canonical_part_number(part_number: str) -> str:
    return re.sub(r"\s+", "", (part_number or "").upper())


def decode_part_number(part_number: str) -> dict[str, str] | None:
    match = PART_NUMBER_RE.match(part_number)
    if not match:
        return None
    decoded = match.groupdict()
    decoded["slashSheet"] = f"/{decoded['slashSheet']}"
    return decoded


def is_d38999_part_number(part_number: str) -> bool:
    return decode_part_number(canonical_part_number(part_number)) is not None


def base_record(part_number: str) -> dict[str, Any]:
    canonical = canonical_part_number(part_number)
    return {
        "partNumber": canonical,
        "normalizedPartNumber": normalize_part_number(canonical),
        "decoded": decode_part_number(canonical),
        "sourcePresence": {
            "manufacturerVerified": False,
            "catalogExample": False,
            "federalConnectorsExact": False,
            "federalConnectorsImportable": False,
            "qpl": False,
        },
        "qpls": [],
        "manufacturers": [],
        "sources": [],
        "evidenceLevel": "",
    }


def append_unique(target: list[Any], value: Any) -> None:
    if value not in target:
        target.append(value)


def merge_manufacturer(record: dict[str, Any], manufacturer: str) -> None:
    if manufacturer:
        append_unique(record["manufacturers"], manufacturer)


def evidence_level(source_presence: dict[str, bool]) -> str:
    if source_presence["manufacturerVerified"]:
        return "manufacturer_verified_exact"
    if source_presence["qpl"] and source_presence["federalConnectorsExact"]:
        return "qpl_and_secondary_exact"
    if source_presence["qpl"]:
        return "qpl_listed"
    if source_presence["federalConnectorsImportable"]:
        return "secondary_exact_supported"
    if source_presence["federalConnectorsExact"]:
        return "secondary_exact"
    if source_presence["catalogExample"]:
        return "catalog_example_exact"
    return "other"


def load_verified(records: dict[str, dict[str, Any]]) -> None:
    payload = read_json(DATA_DIR / "d38999_verified_part_numbers.json")
    for entry in payload.get("verifiedPartNumbers", []):
        part_number = entry.get("partNumber", "")
        if not is_d38999_part_number(part_number):
            continue
        normalized = normalize_part_number(part_number)
        record = records.setdefault(normalized, base_record(part_number))
        record["sourcePresence"]["manufacturerVerified"] = True
        merge_manufacturer(record, entry.get("manufacturer", ""))
        append_unique(
            record["sources"],
            {
                "type": "manufacturer_verified",
                "manufacturer": entry.get("manufacturer", ""),
                "series": entry.get("series", ""),
                "citation": entry.get("source", ""),
            },
        )


def load_examples(records: dict[str, dict[str, Any]]) -> None:
    payload = read_json(DATA_DIR / "d38999_part_number_examples.json")
    for entry in payload.get("examples", []):
        part_number = entry.get("originalPartNumber", "")
        if not entry.get("exactPartNumberAppears"):
            continue
        if not is_d38999_part_number(part_number):
            continue
        normalized = normalize_part_number(part_number)
        record = records.setdefault(normalized, base_record(part_number))
        record["sourcePresence"]["catalogExample"] = True
        merge_manufacturer(record, entry.get("manufacturer", ""))
        append_unique(
            record["sources"],
            {
                "type": "catalog_example",
                "manufacturer": entry.get("manufacturer", ""),
                "series": entry.get("series", ""),
                "sourcePdf": entry.get("sourcePdf", ""),
                "sourcePage": entry.get("sourcePage", ""),
                "validationStatus": entry.get("validationStatus", ""),
                "notes": entry.get("notes", ""),
            },
        )


def load_federal_connectors(records: dict[str, dict[str, Any]]) -> None:
    payload = read_json(DATA_DIR / "d38999_federalconnectors_secondary_source.json")
    importable_map = {
        normalize_part_number(item.get("partNumber", "")): item
        for item in payload.get("importableOverlaps", [])
        if item.get("partNumber")
    }
    for entry in payload.get("entries", []):
        part_number = entry.get("partNumber", "")
        if not is_d38999_part_number(part_number):
            continue
        normalized = normalize_part_number(part_number)
        record = records.setdefault(normalized, base_record(part_number))
        record["sourcePresence"]["federalConnectorsExact"] = True
        importable = importable_map.get(normalized)
        if importable:
          record["sourcePresence"]["federalConnectorsImportable"] = True
        append_unique(
            record["sources"],
            {
                "type": "federalconnectors_exact",
                "sourcePage": entry.get("sourcePage", ""),
                "productUrl": entry.get("productUrl", ""),
                "eligibleImport": bool(entry.get("crossCheck", {}).get("eligibleImport")) or bool(importable),
                "manufacturerSupportSources": (entry.get("crossCheck", {}) or {}).get("manufacturerSupportSources", []),
            },
        )


def load_qpl_files(records: dict[str, dict[str, Any]]) -> list[str]:
    qpl_files = sorted(DATA_DIR.glob("qpl_*_part_numbers.json"))
    for path in qpl_files:
        payload = read_json(path)
        qpl_id = str(payload.get("qpl", ""))
        qpl_source = payload.get("source", "")
        scraped_at = payload.get("scraped_at", "")
        for part_number in payload.get("part_numbers", []):
            if not is_d38999_part_number(part_number):
                continue
            normalized = normalize_part_number(part_number)
            record = records.setdefault(normalized, base_record(part_number))
            record["sourcePresence"]["qpl"] = True
            append_unique(record["qpls"], qpl_id)
            append_unique(
                record["sources"],
                {
                    "type": "qpl",
                    "qpl": qpl_id,
                    "source": qpl_source,
                    "scrapedAt": scraped_at,
                    "file": path.name,
                },
            )
    return [path.name for path in qpl_files]


def finalize(records: dict[str, dict[str, Any]], qpl_files: list[str]) -> dict[str, Any]:
    part_numbers = sorted(records.values(), key=lambda item: item["partNumber"])
    counts = Counter()
    for record in part_numbers:
        record["manufacturers"].sort()
        record["qpls"].sort()
        record["evidenceLevel"] = evidence_level(record["sourcePresence"])
        counts[record["evidenceLevel"]] += 1

    summary = {
        "uniquePartNumbers": len(part_numbers),
        "sourceCounts": {
            "manufacturerVerified": sum(1 for record in part_numbers if record["sourcePresence"]["manufacturerVerified"]),
            "catalogExample": sum(1 for record in part_numbers if record["sourcePresence"]["catalogExample"]),
            "federalConnectorsExact": sum(1 for record in part_numbers if record["sourcePresence"]["federalConnectorsExact"]),
            "federalConnectorsImportable": sum(1 for record in part_numbers if record["sourcePresence"]["federalConnectorsImportable"]),
            "qpl": sum(1 for record in part_numbers if record["sourcePresence"]["qpl"]),
        },
        "evidenceLevelCounts": dict(sorted(counts.items())),
        "qplFiles": qpl_files,
    }

    return {
        "schema_version": "2026-05-19",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "description": "Unified database of valid MIL D38999 part numbers built from all PN-bearing JSON datasets in the repository.",
        "inputs": {
            "manufacturerVerified": "data/d38999_verified_part_numbers.json",
            "catalogExamples": "data/d38999_part_number_examples.json",
            "federalConnectors": "data/d38999_federalconnectors_secondary_source.json",
            "qplFiles": qpl_files,
        },
        "summary": summary,
        "partNumbers": part_numbers,
    }


def build_payload() -> dict[str, Any]:
    records: dict[str, dict[str, Any]] = {}
    load_verified(records)
    load_examples(records)
    load_federal_connectors(records)
    qpl_files = load_qpl_files(records)
    return finalize(records, qpl_files)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a unified database of valid D38999 part numbers from repository PN datasets.")
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Output JSON path (defaults to data/d38999_valid_part_numbers.json).",
    )
    args = parser.parse_args()

    output_path = Path(args.output).resolve()
    payload = build_payload()
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {payload['summary']['uniquePartNumbers']} unified valid D38999 part numbers to {output_path}")


if __name__ == "__main__":
    main()